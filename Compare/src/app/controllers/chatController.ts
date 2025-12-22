import { Injectable } from "@angular/core";
import { environment } from "../../environments/environment";

@Injectable({ providedIn: 'root' })
export class Chat {

    private readonly API_BASE = '/apiBase';
    private readonly GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
    private isRefreshing = false; 
    private refreshPromise: Promise<boolean> | null = null;
    private token = '';

    private userid = '690c82410260e266b90a1d9e'; //Hardcodeado para probar -- alex
    private conversationIdNOMCP = ""; //Conversación NOMCP
    private conversationIdMCP = ""; //Conversación MCP 
    
    constructor() { }

    setConversationIDs(idNoMCP: string, idMCP: string): void {
        this.conversationIdNOMCP = idNoMCP;
        this.conversationIdMCP = idMCP;
    }

    async login(username: string, password: string): Promise<any[]> {
        if (username && password) {
        const response = await fetch(`${this.API_BASE}/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username: username, password: password })
            }).then(async response => {
                if (!response.ok) {
                    const errorBody = await response.json();
                    const errorText = errorBody?.error || 'Unknown error';
                    console.log(`Authentication error: ${errorText}`);
                } else {
                    const body = await response.json();
                    this.token = body?.result.token;
                }
            }).catch(error => {
                console.error("Login failed:", error);
            });
        }

       return this.loadRecentConversations();

    }

    async loadRecentConversations(): Promise<any[]> {
        
       //Vamos a cargar las conversaciones existentes con las dos ya incluidas
       let conversations = await fetch(`${this.API_BASE}/${this.userid}/conversations`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`
            },
       });

       let conversationsResponse = await conversations.json();       
       const conversationsList = conversationsResponse.conversations; //Futuramente cargar solo aquella que tenga nombre MCP o NO MCP.

       return conversationsList;
    }
    
    async createConversations(): Promise<void> {

        //La idea es: Crear dos nuevas conversaciones, borrar las dos más recientes y recargar la página.
        //De esta manera, cargaremos las dos siguientes (que idealmente serán las recién creadas)

        //Crear las conversaciones
        const responseNOMCP = await fetch(`${this.API_BASE}/${this.userid}/conversations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`
            },
            body: JSON.stringify({ title: 'NO MCP' })
        });
        
        const conversationNOMCPID = await responseNOMCP.json();

        const responseMCP = await fetch(`${this.API_BASE}/${this.userid}/conversations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`
            },
            body: JSON.stringify({ title: 'MCP' })
        });

        const conversationMCPID = await responseMCP.json();

        if (!responseNOMCP.ok || !responseMCP.ok) {
            console.error("Error creating conversations");
        } else {
            console.log("Conversations created successfully");
        }

        //Borrar las dos conversaciones más recientes
        await this.deleteRecentConversations();
        window.location.reload(); //Recarga la página

    }

    async deleteRecentConversations(){
        //Borrar las dos conversaciones más recientes
        const conversations = await this.loadRecentConversations();

        if (conversations.length <= 2) return;
        
        for (let i = 0; i < 2; i++) { //Como son solo dos ... 
            const convId = conversations[i]._id;
            const response = await fetch(`${this.API_BASE}/${this.userid}/conversations/${convId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                }
            });
            if (!response.ok) {
                console.error(`Error deleting conversation ${convId}`);
            }
        }
    }

    async sendMessageToGemini(message: string): Promise<{outputNoMCP: any, outputMCP: any}> {
        try {

                // Enviando mensaje al AI agent sin MCP
                const responseNoMCP = await fetch(`${this.API_BASE}/${this.userid}/conversations/${this.conversationIdNOMCP}/messages`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.token}`
                    },
                    body: JSON.stringify({ question: message, tag: 'NO_MCP' })
                })

                if (!responseNoMCP.ok) {
                    throw new Error(`HTTP error NO MCP! status: ${responseNoMCP.status}`);
                }

                const dataNoMCP = await responseNoMCP.json();
                console.log("[NO MCP] Gemini response:", dataNoMCP);

                // Enviando mensaje al AI agent con MCP

                const responseMCP = await fetch(`${this.API_BASE}/${this.userid}/conversations/${this.conversationIdMCP}/messages`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.token}`
                    },
                    body: JSON.stringify({ question: message, tag: 'MCP'}), //Cuerpo: mensaje en formato JSON
                });

                if (!responseMCP.ok) {
                    throw new Error(`HTTP error MCP! status: ${responseMCP.status}`);
                }

                let dataMCP = await responseMCP.json();
                console.log("[MCP] Gemini response:", dataMCP);

            return {
                outputNoMCP: {respuesta: dataNoMCP.respuesta, usage: dataNoMCP.usage},
                outputMCP: {respuesta: dataMCP.respuesta, usage: dataMCP.usage}
            };

        }
         catch(error) {
            console.error("Error in sendMessageToGemini:", error);
            return Promise.reject("Error sending message to Gemini: " + error);
        }
    }
}