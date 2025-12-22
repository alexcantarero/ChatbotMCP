import { MongoClient, ObjectId } from 'mongodb';
import moment from 'moment';
import crypto from 'crypto';
import readline from 'readline';
import jwt from 'jsonwebtoken';
import dotenv from "dotenv";

const uri = 'mongodb://localhost:27017'; // URI
const client = new MongoClient(uri); // Cliente de MongoDB
dotenv.config();

function hash(str){
  const hashed = crypto.createHash('sha256').update(str).digest('hex');
  return hashed;
}

async function loginUser(username, password){
  try {
    await client.connect();
    console.log("Conectado a la base de datos para login");
    const db = client.db('geminiChatbot');
    const users = db.collection('users');
    const hashedPassword = hash(password);
    const user = await users.findOne({ username: username, passwordHash: hashedPassword });
    
    if(user){
      let jwtSecretKey = process.env.JWT_SECRET;
      let data = {
          time: Date(),
          userId: user._id,
      }
    const token = jwt.sign(data, jwtSecretKey, { expiresIn: '1h' });
      console.log("Usuario autenticado correctamente:", username,user._id);
      return { userId: user._id, token: token };
    }
    console.log("No se ha encontrado el usuario o la contraseña es incorrecta");
    return null;
  } finally {
    await client.close();
  }
}

async function addMessage(conversationId, newMessage, role, userId, usage) {
  try {
    await client.connect();
    const db = client.db('geminiChatbot');
    const conversations = db.collection('conversations');
    console.log("conversationID", conversationId);

    const check = await conversations.findOne(
      { _id: new ObjectId(conversationId) } //OJO! el _id es un ObjectId, no un string.
    );
    if (check.userId !== userId) {
      const error =  new Error('User ID does not match conversation owner');
      error.statusCode = 403;
      throw error;
    }

    const result = await conversations.updateOne(
      { _id: new ObjectId(conversationId) }, //OJO! el _id es un ObjectId, no un string.
      { $push: { messages: { role, content: newMessage, dateTime: new Date().toISOString(), usage: usage } } }
    );

    console.log('Resultado:', result.modifiedCount > 0 ? 'Mensaje añadido' : 'No se encontró la conversación');
  } finally {
    await client.close();
  }
}

async function createNewUser(username, password){
  try{
    await client.connect();
    const db = client.db('geminiChatbot');
    const users = db.collection('users');
    console.log("Creando un nuevo usuario en la base de datos...");
    const hashedPassword = hash(password);
    const checkExisting = await users.findOne({ username: username });
    if(checkExisting){
      const error = new Error('Username already exists');
      error.statusCode = 409;
      throw error;
    }
    const result = await users.insertOne(
      {
        username: username,
        passwordHash: hashedPassword,
      }
    );
    return result.insertedId.toString();
  }
  catch (error){
    console.error('Error creating new user:', error);
    throw error;
  }
  finally{
    await client.close();
  }
}

async function createConversation(conversationTitle, userId){
  try {
    await client.connect();
    const db = client.db('geminiChatbot');
    const conversations = db.collection('conversations');
    console.log("Creando una nueva conversación en la base de datos...");
    const result = await conversations.insertOne(
      {
        conversationDateStarted: new Date().toISOString(),
        userId: userId,
        messages: [],
        title: conversationTitle
      }
    );
    let isInserted = moment().format('MMMM Do YYYY, h:mm:ss a');
    console.log("Se ha creado la conversación en el momento", isInserted)
    //Devuelvo el ID de la conversación creada
    return result.insertedId.toString();
  } finally{
      await client.close();
  }
}

async function deleteConversation(conversationId, userId){
  try {
    await client.connect();
    const db = client.db('geminiChatbot');
    const conversations = db.collection('conversations');

    console.log("Borrando una conversación en la base de datos..., ID:", conversationId);

    const check = await conversations.findOne(
      { _id: new ObjectId(conversationId) } //OJO! el _id es un ObjectId, no un string.
    );
    if (check.userId !== userId) {
      const error = new Error('User ID does not match conversation owner');
      error.statusCode = 403;
      throw error;
    }
    const result = await conversations.deleteOne(
      { _id: new ObjectId(conversationId) }
    );
    return result.deletedCount > 0;
  } finally {
    await client.close();
  }
}

async function modifyConversationTitle(conversationId, newTitle, userId){
  try {
    await client.connect();
    const db = client.db('geminiChatbot');
    const conversations = db.collection('conversations');
    const check = await conversations.findOne(
      { _id: new ObjectId(conversationId) } //OJO! el _id es un ObjectId, no un string.
    );
    if (check.userId !== userId) {
      const error = new Error('User ID does not match conversation owner');
      error.statusCode = 403;
      throw error;
    }
    const result = await conversations.updateOne(
      { _id: new ObjectId(conversationId) }, //OJO! el _id es un ObjectId, no un string.
      { $set: { title: newTitle } }
    );
    console.log('Resultado:', result.modifiedCount > 0 ? 'Título modificado' : 'No se encontró la conversación o el título es el mismo');
    return result.modifiedCount > 0;
  } finally {
    await client.close();
  }
}

async function modifyConversationExpirationDate(conversationId, newExpirationDate, userId){

  try {
    await client.connect();
    const db = client.db('geminiChatbot');
    const conversations = db.collection('conversations');
    const check = await conversations.findOne(
      { _id: new ObjectId(conversationId) } //OJO! el _id es un ObjectId, no un string.
    );
    if (check.userId !== userId) {
      const error = new Error('User ID does not match conversation owner');
      error.statusCode = 403;
      throw error;
    }
    const result = await conversations.updateOne(
      { _id: new ObjectId(conversationId) }, //OJO! el _id es un ObjectId, no un string.
      { $set: { conversationDateStarted: newExpirationDate } }
    );
    console.log('Resultado:', result.modifiedCount > 0 ? 'Fecha de expiración modificada' : 'No se encontró la conversación o la fecha es la misma');
    return result.modifiedCount > 0;
  } finally {
    await client.close();
  }
}

async function getAllConversations(){
  try {
      await client.connect();
      const db = client.db('geminiChatbot');
      const conversations = db.collection('conversations');
      const allConversations = await conversations.find({}).toArray();
      return allConversations;
  }
  finally {
      await client.close();
  }
}

async function getAllConversationsFromUser(userId){
  try {
      await client.connect();
      const db = client.db('geminiChatbot');
      const conversations = db.collection('conversations');
      const userConversations = await conversations.find({ userId: userId }).toArray();
      return userConversations;
  }
  finally {
      await client.close();
  }
}

async function getConversation(conversationId, userId){
  try {
      await client.connect();
      const db = client.db('geminiChatbot');
      const conversations = db.collection('conversations');
      const conversation = await conversations.findOne(
          { _id: new ObjectId(conversationId) } //OJO! el _id es un ObjectId, no un string.
      );
      return conversation;
  }
  finally {
      await client.close();
  }
}

async function getMessagesConversation(conversationID, userId){
  try{
    await client.connect();
    const db = client.db('geminiChatbot');
    const conversation = await getConversation(conversationID, userId);
    if(!conversation){
      throw new Error('Conversation not found');
    }
    else if(conversation.userId !== userId){
      const error = new Error('User ID does not match conversation owner');
      error.statusCode = 403;
      throw error;
    }
    return conversation.messages;
  } catch (error) {
    console.error('Error fetching messages:', error);
    throw new Error('Failed to fetch messages');
    
  } finally {
    await client.close();
  }
}

async function retrieveUsage(executionID, tag){


  let executionInformation = await fetch(`http://localhost:5678/api/v1/executions/${executionID}?includeData=true`, //Fetch from api/v1/executions/:id
  {
    method: 'GET',
    headers: {
        'X-N8N-API-KEY': process.env.API_KEY_N8N
    }

  });
  if (!executionInformation.ok) {
      throw new Error(`N8N Executions API error: ${executionInformation.status} ${executionInformation.statusText}`);
  }
  const executionData =  await executionInformation.json(); //Obtenemos la ejecución concreta.

  const modelName = tag == "NO_MCP" ? "Google Gemini Chat Model2" : "Google Gemini Chat Model"; // Determinamos el nombre del modelo dependiendo del tag pasado como parámetro.
  const agentName = tag == "NO_MCP" ? "AI Agent2" : "AI Agent1"; // Determinamos el nombre del agente dependiendo del tag pasado como parámetro.
  const runDataArray = executionData?.data?.resultData?.runData?.[modelName] || []; //Obtenemos el array de ejecuciones (function calls, responses)
  const executionDataArray = executionData?.data?.resultData?.runData?.[agentName] || []; //Obtenemos el array de datos de ejecución (tiempos, etc)
  
  //Inicializamos usage
  let usage = {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    execution_time: 0,
  };

  //Ahora sumamos todos los costes de las ejecuciones:
  for (let i = 0; i < runDataArray.length; i++) { //Por cada ejecución
    const tokenUsage = runDataArray[i]?.data?.ai_languageModel?.[0]?.[0]?.json?.tokenUsage;
          console.log(`Token usage for run ${i}:`, tokenUsage);
    if (tokenUsage) {
      usage.input_tokens += tokenUsage.promptTokens || 0; //Sumamos cada tipo de token en su categoría pertinente.
      usage.output_tokens += tokenUsage.completionTokens || 0;
      usage.total_tokens += tokenUsage.totalTokens || 0;
    }
  
  }
  //Ahora obtenemos el tiempo de ejecución total
  let executionTimeinMS = Number(executionDataArray[0].executionTime)/1000;
  console.log("Tiempo de ejecución total (s):", executionTimeinMS);
  usage.execution_time = executionTimeinMS.toString(); //En segundos

  return usage; //Devolvemos el uso total de los tokens y el tiempo de ejecución.
}

async function deleteOutdatedConversations(daysThreshold) {
  console.log("Eliminando conversaciones con antigüedad de ", daysThreshold, "o más días");
  try {
    await client.connect();
    const db = client.db('geminiChatbot');
    const conversations = db.collection('conversations');
    
    const allConversations = await conversations.find({}).toArray(); //Almaceno todas las conversaciones aquí
    
    let deletedCount = 0; //Conversaciones eliminadas
    
    for (const conv of allConversations) { //Por cada una de las conversaciones
      const conversationDate = moment(conv.conversationDateStarted); //Extraigo su fecha de creación
      const diffDays = moment().diff(conversationDate, 'days'); //Calculo la diferencia en días desde ahora hasta esa fecha
      
      console.log(`Conversación ${conv._id}: ${conversationDate.format('YYYY-MM-DD HH:mm:ss')} (hace ${diffDays} días)`);
      
      if (diffDays >= daysThreshold) { //Si han pasado más días que el umbral (en principio solo 1 día)
        const result = await conversations.deleteOne({ _id: conv._id }); //La eliminamos de la BDD
        if (result.deletedCount > 0) {
          deletedCount++; //Añadimos 1 al contador
          console.log(`Conversación ${conv._id} eliminada (${diffDays} días de antigüedad)`);
        }
      }
    }
    
    console.log(` Total de conversaciones eliminadas: ${deletedCount}`);
    return deletedCount;
  } catch (error) {
    console.error(' Error eliminando conversaciones obsoletas:', error);
    throw error;
  } finally {
    await client.close();
  }
}
export { loginUser, addMessage, createConversation, createNewUser, getConversation, getAllConversations, getAllConversationsFromUser, getMessagesConversation, deleteConversation, modifyConversationTitle, modifyConversationExpirationDate, deleteOutdatedConversations, retrieveUsage };