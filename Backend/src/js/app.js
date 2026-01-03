import express from "express"; //Import express
import dotenv from "dotenv"; //Import dotenv para gestionar variables de entorno
import { GoogleGenerativeAI } from "@google/generative-ai"; //Import Google Generative AI SDK
import { createConversation, createNewUser, getAllConversationsFromUser, getConversation, getMessagesConversation, addMessage, deleteConversation, modifyConversationTitle, modifyConversationExpirationDate, deleteOutdatedConversations, loginUser, retrieveUsage } from "./database.js"; // Import the specific functions
import cookieParser from "cookie-parser";
import jwt from 'jsonwebtoken';

import tools from './tools/tools.js'; //Importar las rutas de tools



dotenv.config(); //Cargamos las variables de entorno desde el archivo .env

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); //Creamos una instancia del cliente de Google Generative AI con la API Key
const app = express(); //Creamos una instancia de express
const PORT = 3001; //Le asigno el puerto 3001

const conversations = new Map();
/* Esto es un mapa de conversaciones. Tiene como clave el identificador de la conversación,
y como valor la instancia del chat que corresponde a la conversación. Cada uno de los chats 
tiene su propio historial, el cual se rellena automáticamente cada vez que se envía un mensaje.
Por eso si llamamos a este mapa, podemos hacer que Gemini responda con contexto de los anteriores
mensajes */

app.use(express.json()); //Middleware para parsear JSON
app.use(cookieParser()); //Middleware para parsear cookies

app.use('/tools', tools); //Usar las rutas de tools en /tools

// Añadir estas variables globales al inicio del archivo (después de las importaciones)
let amadeusTokenCache = null;
let amadeusTokenExpiry = null;

const fetchAmadeusAccessToken = async () => {
    const clientId = process.env.AMADEUS_API_KEY;
    const clientSecret = process.env.AMADEUS_API_SECRET;
    const baseUrl = process.env.AMADEUS_URL || 'https://test.api.amadeus.com';

    // Verificar si tenemos un token en caché que aún es válido
    if (amadeusTokenCache && amadeusTokenExpiry && Date.now() < amadeusTokenExpiry) {
        console.log("Usando token de Amadeus desde caché");
        return amadeusTokenCache;
    }

    // Si client credentials están disponibles, solicitar un nuevo token
    if (clientId && clientSecret) {
        const tokenUrl = `${baseUrl}/v1/security/oauth2/token`;
        console.log("Obteniendo nuevo token de Amadeus desde:", tokenUrl);
        
        const params = new URLSearchParams();
        params.set('grant_type', 'client_credentials');
        params.set('client_id', clientId);
        params.set('client_secret', clientSecret);

        try {
            const res = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString(),
                signal: AbortSignal.timeout(15000) // Aumentar timeout a 15 segundos
            });

            if (!res.ok) {
                const error = await res.json().catch(() => ({}));
                throw new Error(`Amadeus token error: ${res.status} ${res.statusText} ${error.error_description || JSON.stringify(error)}`);
            }

            const data = await res.json();
            if (!data || !data.access_token) throw new Error('No access_token returned from Amadeus');
            
            // Cachear el token (expira en 30 minutos según Amadeus, lo ponemos en 25 para estar seguros)
            amadeusTokenCache = data.access_token;
            amadeusTokenExpiry = Date.now() + (25 * 60 * 1000); // 25 minutos
            
            console.log("Token de Amadeus obtenido y cacheado");
            return data.access_token;
        } catch (error) {
            console.error("Error obteniendo token de Amadeus:", error.message);
            
            // Si falla, intentar usar el token de respaldo si existe
            if (process.env.AMADEUS_BEARER_TOKEN) {
                console.log("Usando token de respaldo desde .env");
                return process.env.AMADEUS_BEARER_TOKEN;
            }
            
            throw error;
        }
    }

    // Fallback: si un token env está disponible, usarlo
    if (process.env.AMADEUS_BEARER_TOKEN) {
        return process.env.AMADEUS_BEARER_TOKEN;
    }

    throw new Error('Missing Amadeus credentials: set AMADEUS_API_KEY and AMADEUS_API_SECRET, or AMADEUS_BEARER_TOKEN in env');
}
export { fetchAmadeusAccessToken }; // Exportar la función para usarla en otras partes

/* Función que se ejecuta antes de los endpoints seleccionados (en este caso, necesito que se haga para todos los de la app menos el login) para comprobar que el token de las headers corresponde con 
   el usuario que se pasa como query parameter. */
const authenticateToken = (req, res, next) => {
  console.log("Verificando token");
  const token = req.headers['authorization']?.split(' ')[1]; // Extraemos el token de las headers
  
  if (!token) {
    return res.status(401).json({ok: false, error: 'No token provided'});
  }
  
  try {
    // Vamos a verificar el token: si corresponde al usuario o ha expirado
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    console.log("UserID del parámetro:", req.params.userid);
    
    if(payload.userId !== req.params.userid) { // Si no coinciden los userId, significa que este token no es del usuario que toca!
      return res.status(403).json({ok: false, error: 'User ID does not match token'});
    }
    
    req.user = payload; // Opcional: guardar el payload en req para usarlo después
    next();
  } catch (error) {
    // jwt.verify lanza error si el token expiró o es inválido
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ok: false, error: 'Token expired'});
    }
    return res.status(403).json({ok: false, error: 'Invalid token'});
  }
}

//Aquí especificamos las rutas que necesitan autenticación
app.use('/:userid/conversations/:id/messages', authenticateToken); // Aplicar autenticación al enviar un mensaje
app.use('/:userid/conversations/:id/', authenticateToken); // Aplicar autenticación al consultar una conversación por su id
app.use('/:userid/conversations/', authenticateToken); // Aplicar autenticación al obtener las conversaciones de un usuario


const model = genAI.getGenerativeModel({model:"gemini-2.0-flash-lite"});

// Middleware de CORS
app.use((req, res, next) => { // Este método se ejecuta en cada solicitud, para configurar los headers CORS
  res.setHeader("Access-Control-Allow-Origin", "*"); // Permitir solicitudes desde cualquier origen
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization"); // Authorization para futuros usos
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});


// Ruta que se usa para ver si el servidor está funcionando correctamente
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor Express funcionando correctamente.' });
});

// Endpoint de login. Permite buscar si existe un usuario con esas credenciales, y si es así, devuelve su información.
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  // Aquí iría la lógica de autenticación real
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'Username and password are required' });
  }
  const result = await loginUser(username, password);
  //Si el login (obtención del accessToken es correcto)
  if (result) {
    const refreshToken = jwt.sign(
      {
        userId: result.userId
      },process.env.JWT_SECRET,{expiresIn: '1d'}
    );

    res.cookie('jwt', refreshToken, {
      httpOnly: true,
      sameSite: 'None',
      secure: true,
      maxAge: 24 * 60 * 60 * 1000
    });
    return res.json({ ok: true, result });
  } else {
    return res.status(406).json({ ok: false, error: 'Wrong username or password' });
  }
});

app.post('/refresh', (req, res) => {
    if (req.cookies?.jwt) {
      const refreshToken = req.cookies.jwt;
        jwt.verify(refreshToken, process.env.JWT_SECRET,
            (err, decoded) => {
                if (err) {
                    // Wrong Refesh Token
                    return res.status(406).json({ message: 'Unauthorized' });
                }
                else {
                    // Correct token we send a new access token
                    let data = 
                    {
                      time: Date(),  
                      userId: decoded.userId
                    };
                    let jwtSecretKey = process.env.JWT_SECRET;
                    const accessToken = jwt.sign(data, jwtSecretKey, { expiresIn: '1h' });
                    return res.json({ token: accessToken });
                }
            })
    } else {
        return res.status(406).json({ message: 'Unauthorized' });
    }
});

// Obtener todas las conversaciones de un usuario en concreto
app.get("/:userid/conversations", async (req, res) => {
  const userId = req.params.userid;
  if(!userId) return res.status(400).json({ ok: false, error: 'User ID is required' });
  const conversations = await getAllConversationsFromUser(userId);
  res.json({ ok: true, conversations });
});

// Obtener una conversación en específico por su ID
app.get("/:userid/conversations/:id", async (req, res) => {
  const userId = req.params.userid;
  const conversationId = req.params.id;
  if(!userId) return res.status(400).json({ ok: false, error: 'User ID is required' });
  if(!conversationId) return res.status(400).json({ ok: false, error: 'Conversation ID is required' });
  try {
    const conversation = await getConversation(conversationId, userId);
    if (conversation.userId !== userId) {
      return res.status(403).json({ ok: false, error: 'Conversation does not exist for this user' });
    }
    res.json({ ok: true, conversation });
  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({ ok: false, error: 'Failed to fetch conversation' });
  }
});

// Actualizar el título de una conversación
app.put("/:userid/conversations/:id", async (req, res) => {

  const userId = req.params.userid;
  const conversationId = req.params.id;
  const newTitle = req.body.title;

  if(!userId) return res.status(400).json({ ok: false, error: 'User ID is required' });
  if(!conversationId) return res.status(400).json({ ok: false, error: 'Conversation ID is required' });
  if(!newTitle) return res.status(400).json({ ok: false, error: 'New title is required' });
  
  console.log("El ID de la conversación a modificar es:", conversationId);
  console.log("El nuevo título es:", newTitle);
  try {
    await modifyConversationTitle(conversationId, newTitle, userId);
    res.json({ ok: true, message: 'Conversation title modified successfully' });
  } catch (error) {
    console.error('Error modifying conversation title:', error);
    res.status(error.statusCode).json({ ok: false, error: error.message});
  }
});

// Actualizar la fecha de expiración de una conversación
app.put("/:userid/conversations/:id/date", async (req, res) => {

  const userId = req.params.userid;
  const conversationId = req.params.id;
  const newExpirationDate = new Date().toISOString();

  if(!userId) return res.status(400).json({ ok: false, error: 'User ID is required' });
  if(!conversationId) return res.status(400).json({ ok: false, error: 'Conversation ID is required' });

  console.log("El ID de la conversación a modificar es:", conversationId);
  console.log("La nueva fecha de expiración es:", newExpirationDate);
  try {
    await modifyConversationExpirationDate(conversationId, newExpirationDate, userId);
    res.json({ ok: true, message: 'Conversation expiration date modified successfully' });
  } catch (error) {
    console.error('Error modifying conversation expiration date:', error);
    res.status(error.statusCode).json({ ok: false, error: error.message});
  }
});

//Obtener los mensajes específicos de una conversación
app.get("/:userid/conversations/:id/messages", async (req, res) => {
  const userId = req.params.userid;
  const conversationId = req.params.id;
  if(!userId) return res.status(400).json({ ok: false, error: 'User ID is required' });
  if(!conversationId) return res.status(400).json({ ok: false, error: 'Conversation ID is required' });
  try{
    const messages = await getMessagesConversation(conversationId, userId);
    res.json({ ok: true, messages });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ ok: false, error: 'Failed to fetch messages' });
  }
});

// Crear una nueva conversación
app.post("/:userId/conversations", async (req, res) => {
  try {

    console.log("Creando una nueva conversación...");
    if(req.body.title === undefined){ // Si no hay título ...
      return res.status(400).json({ ok: false, error: 'Title is required' });
    }

    if(req.params.userId === undefined){ // Si no hay userId ...
      return res.status(400).json({ ok: false, error: 'User ID is required' });
    }

    const conversationId = await createConversation(req.body.title, req.params.userId);
    
  
    // Return the ObjectID to the frontend
    res.status(201).json({ 
      ok: true, 
      conversation_id: conversationId 
    });

    //Añadimos la conversación al mapa de conversaciones en memoria.
    let conv = model.startChat({history: []}); //Historial vacío: no hay mensajes previos.
    conversations.set(conversationId, conv); //Añadimos la conversación al map
    console.log("Conversación añadida al mapa, ID:", conversationId);

  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Failed to create conversation' 
    });
  }
});

// Enviar un mensaje a la conversación
app.post("/:userid/conversations/:id/messages", async (req, res) => {

    let ms = req.body?.mensaje ?? req.body;
    if(req.params.userid === undefined){ // Si no hay userId ...
      return res.status(400).json({ ok: false, error: 'User ID is required' });
    }
    if(req.params.id === undefined){ // Si no hay conversationId ...
      return res.status(400).json({ ok: false, error: 'Conversation ID is required' });
    }
    if(ms === undefined || ms === null){ // Si no hay mensaje ...
      return res.status(400).json({ ok: false, error: 'Message is required' });
    }
    // Si el cliente envía un objeto con campos como { question: '...' }, lo convertimos a string
    if (typeof ms === "object") {
      try {
       ms = ms.question;
      } catch (e) {
        ms = String(ms);
      }
    }
    console.log("Mensaje recibido del cliente", ms);
    console.log("Tag recibido del cliente", req.body?.tag);
    try {
      await addMessage(req.params.id, ms, 'user', req.params.userid, {}); //Se añade el mensaje a la base de datos
      const response_ai = await ask_gemini(ms, req.params.id, req.token, req.body?.tag); //Se llama al N8N que a su vez llama a Gemini
      console.log("Respuesta de Gemini:", response_ai.responseText, " con uso de tokens:", response_ai.usage);
      await addMessage(req.params.id, response_ai.responseText, 'ai', req.params.userid, response_ai.usage); //Se añade la respuesta de Gemini a la base de datos
      res.status(200).json({ ok: true, respuesta: response_ai.responseText, usage: response_ai.usage });
    } catch (error) {
      console.error('Error processing message:', error);
      res.status(500).json({ ok: false, error: error });
    }
});

// Eliminar una conversación
app.delete("/:userid/conversations/:id", async (req, res) => {

  const conversationId = req.params.id;

  if(!conversationId) return res.status(400).json({ ok: false, error: 'Conversation ID is required' });

  if(!req.params.userid) return res.status(400).json({ ok: false, error: 'User ID is required' });

  console.log("El ID de la conversación a eliminar es:", conversationId);

  try {
    const deleted = await deleteConversation(conversationId, req.params.userid);
    if (deleted) {
      res.json({ ok: true, message: 'Conversation deleted successfully' });
    } else {
      res.status(404).json({ ok: false, error: 'Conversation not found' });
    }
  } catch (error) {
    console.error('Error deleting conversation:', error);
    res.status(error.statusCode).json({ ok: false, error: error.message });
  }
});

//Crear un nuevo usuario.
app.post("/users", async (req, res) => {
  const username = req.body.username;
  const password = req.body.password;

  if(!username || !password){
    return res.status(400).json({ ok: false, error: 'Username and password are required' });
  }
  if(typeof username !== 'string' || typeof password !== 'string'){
    return res.status(400).json({ ok: false, error: 'Username and password must be of type String' });
  }

  try{
    await createNewUser(username, password);
    res.status(201).json({ ok: true, message: 'User created successfully' });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(error.statusCode || 500).json({ ok: false, error: error.message });
  }

});

async function ask_gemini(message, conversationId, token, tag) {
    try {
        // const chat = await getOrCreateChat(conversationId); //Buscamos el chat en el array o reconstruimos el chat que ya existía en memoria.
        const contentToSend = typeof message === "string" ? message : String(message);
        console.log("Enviando a Gemini el mensaje:", contentToSend);

        //Dependiendo del tag, enviaremos el mensaje a un webhook u otro

        let url = "";
        if(tag == "NO_MCP"){
            console.log("Enviando a N8N sin MCP");
            url = process.env.N8N_WEBHOOK_URL_NO_MCP;
        }
        else{
            console.log("Enviando a N8N con MCP");
            url = process.env.N8N_WEBHOOK_URL_MCP;
        }


        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                message: message,
                conversationId: conversationId,
                timestamp: new Date().toISOString(),

            })
        });
        if (!response.ok) {
            throw new Error(`N8N error: ${response.status} ${response.statusText}`);
        }

        // La respuesta viene como un texto, así que la parseamos a JSON
        const rawData = await response.text();

        const data = JSON.parse(rawData);

        const responseText = data.output;
        const executionID = data.executionID; //ID de la ejecución en N8N para sacar los tokens.

        let usage = await retrieveUsage(executionID, tag); //Obtenemos el uso de tokens a partir del ID de ejecución y el tag.

        if (!responseText) {
            throw new Error('N8N devolvió una respuesta vacía');
        }

        console.log("Respuesta de N8N:", responseText, " con usage :", usage);
        return {responseText, usage};
    } catch (error) {
        console.error('Error en ask_gemini:', error);
        throw error;
    }
}

app.listen(PORT, async () => {
    console.log("Servidor iniciado...");
    try {
        await deleteOutdatedConversations(1);
        console.log("Limpieza completada con éxito");
    } catch (error) {
        console.error("Error en la limpieza inicial:", error);
    }
});