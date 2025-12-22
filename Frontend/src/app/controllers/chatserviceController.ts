import { Component } from '@angular/core';
import { Injectable } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MarkdownModule } from 'ngx-markdown';
import { App } from '../app';
import { AuthService } from '../authservice/auth.service';

@Injectable({ providedIn: 'root' })
export class ChatService {

  private readonly API_BASE = '/api'; //Endpoint base para el proxy
  private isRefreshing = false; // Flag para evitar múltiples refreshes simultáneos
  private refreshPromise: Promise<boolean> | null = null; //Para que se esperen las siguientes peticiones si hay que hacer refresh del token.

  constructor(private auth: AuthService) {}

  get token(): string {
    return this.auth.getToken();
  }

  // Método para refrescar el token usando el refresh token de las cookies
  private async refreshToken(): Promise<boolean> {
    // Si ya hay un refresh en curso, esperar a que termine
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    this.isRefreshing = true;
    this.refreshPromise = (async () => {
      try {
        console.log("Intentando refrescar el token...");
        const res = await fetch(`${this.API_BASE}/refresh`, { //Llamada al endpoint /refresh
          method: 'POST',
          credentials: 'include', // Importante: envía las cookies (para poder almacenar el refresh token)
          headers: {
            'Content-Type': 'application/json'
          }
        });

        if (!res.ok) {
          console.error("Error al refrescar token:", res.status);
          return false;
        }

        const response = await res.json();
        const newToken = response?.token || '';        
        if (newToken) { //Si el nuevo accessToken se ha generado correctamente...
          this.auth.setToken(newToken); //Seteamos el nuevo token en el AuthService
          console.log("Token refrescado exitosamente");
          return true;
        } else { // Si no se ha recibido un nuevo token...
          console.error("No se recibió un nuevo token en la respuesta");
          return false;
        }
      } catch (e) {
        console.error("Error al refrescar token:", e);
        return false;
      } finally {
        this.isRefreshing = false;
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  // Método para hacer fetch con retry automático en caso de 401. Se usa en todos los endpoints.
  private async fetchWithRetry(url: string, options: RequestInit): Promise<Response> {
    
    let response = await fetch(url, options);

    // Si recibimos 401 y aún tenemos retries disponibles, intentar refrescar el token
    if (response.status === 401) {
      console.log("Recibido 401, intentando refrescar token...");
      const refreshSuccess = await this.refreshToken(); //Llamamos a /refresh
      
      if (refreshSuccess) { //Si ha ido bien el refresh y tenemos el nuevo token ... 
        // Actualizar el header de autorización con el nuevo token
        const newOptions = {
          ...options, // Añadimos options de la petición original
          headers: { // Modificamos sólo los headers
            ...options.headers, // Mantenemos los headers originales
            'Authorization': `Bearer ${this.token}` //Se obtiene el token de authService
          }
        };
        
        // Reintentamos la petición con el nuevo token
        console.log("Reintentando petición con nuevo token...");
        response = await fetch(url, newOptions);
      } else {
        console.error("No se pudo refrescar el token, la sesión ha expirado");
      }
    }

    return response;
  }

  //Enviar un mensaje al LLM
  async sendMessage(message: string, conversationId: string, endpoint: string = '/:userid/conversations/:id/messages', userId: string): Promise<string> {
    try {
      const url = `${this.API_BASE}${endpoint.replace(':id', conversationId).replace(':userid', userId)}`;
      const options: RequestInit = { //Opciones de la petición
        method: 'POST', //Método POST
        headers: { //Headers: contenido en formato JSON y Bearer Token
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({ question: message }), //Cuerpo: mensaje en formato JSON
        credentials: 'include' //Incluimos las cookies (para enviar el refresh token si se necesita luego)
      };

      const res = await this.fetchWithRetry(url, options); //Llamamos a fetch with retry

      if (!res.ok) {
        const errorText = await res.text();
        console.error("Error del backend:", res.status, errorText);
        throw new Error(`Error del backend: ${res.status} - ${errorText}`);
      }

      const response = await res.json();
      console.log("Respuesta de Gemini:", response.respuesta); 
      
      return response.respuesta;
      
    } catch (e) {
      console.error("Error en sendMessage:", e);
      const fallback = `Ups! Algo ha fallado. Comprueba la consola.`;
      console.log("Usando fallback:", fallback);
      return fallback;
    }
  }

  //Crear una nueva conversación
  async createNewConversation(endpoint: string = '/:userId/conversations', conversationTitle: string, userId: string): Promise<string> {
    try {
      console.log("Creando nueva conversación... para userId:", userId);
      endpoint = endpoint.replace(':userId', userId);
      const url = `${this.API_BASE}${endpoint}`;
      const options: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({ title: conversationTitle }),
        credentials: 'include'
      };

      const res = await this.fetchWithRetry(url, options);
  
      if (!res.ok) {
        const errorText = await res.text();
        console.error("Error del backend:", res.status, errorText);
        throw new Error(`Error del backend: ${res.status} - ${errorText}`);
      }

      const response = await res.json();
      console.log("Nueva conversación creada:", response);
      return response.conversation_id;

    } catch (e) {
      console.error("Error en createNewConversation:", e);
      const fallback = `Ups! Algo ha fallado. Comprueba la consola.`;
      console.log("Usando fallback:", fallback);
      return fallback;
    }
  }

  //Editar el título de una conversación existente
  async editConversationTitle(conversationId: string, newTitle: string, endpoint: string = ':userid/conversations/:id', userId: string): Promise<boolean> {
  
    try{
      const url = `${this.API_BASE}${endpoint.replace(':id', conversationId).replace(':userid', userId)}`;
      const options: RequestInit = {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({ title: newTitle }),
        credentials: 'include'
      };

      const res = await this.fetchWithRetry(url, options);

      if (!res.ok) {
        const errorText = await res.text();
        console.error("Error del backend:", res.status, errorText);
        throw new Error(`Error del backend: ${res.status} - ${errorText}`);
      }

      console.log("Título de conversación editado:", conversationId, newTitle);
      return true;

    } catch (e) {
      console.error("Error en editConversationTitle:", e);
      const fallback = `Ups! Algo ha fallado. Comprueba la consola.`;
      console.log("Usando fallback:", fallback);
      return false;
    }
  }

  async updateConversationDate(conversationId: string, endpoint: string = '/:userid/conversations/:id', userId: string): Promise<boolean> {
    try {
      console.log("Actualizando fecha de conversación:", conversationId);
      const url = `${this.API_BASE}${endpoint.replace(':id', conversationId).replace(':userid', userId)}`;
      const options: RequestInit = {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({ updateDate: true }),
        credentials: 'include'
      };
      const res = await this.fetchWithRetry(url, options);

      if (!res.ok) {
        const errorText = await res.text();
        console.error("Error del backend:", res.status, errorText);
        throw new Error(`Error del backend: ${res.status} - ${errorText}`);
      }

      console.log("Fecha de conversación actualizada:", conversationId);
      return true;
    }
    catch (e) {
      console.error("Error en updateConversationDate:", e);
      return false;
    }
  }

  //Cargar todas las conversaciones ya existentes
  async loadAllConversations(endpoint: string = '/:userid/conversations', userId: string): Promise<string[]> {
    try {
      console.log("Cargando todas las conversaciones del usuario ...", userId, "con token :", this.token);
      endpoint = endpoint.replace(':userid', userId);
      const url = `${this.API_BASE}${endpoint}`;
      const options: RequestInit = {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        credentials: 'include'
      };

      const res = await this.fetchWithRetry(url, options);

      if (!res.ok) {
        const errorText = await res.text();
        console.error("Error del backend:", res.status, errorText);
        throw new Error(`Error del backend: ${res.status} - ${errorText}`);
      }
      const response = await res.json();
      console.log(`${this.API_BASE}${endpoint}`);
      return response.conversations;
    } catch (e) {
      console.error("Error en loadAllConversations:", e);
      return [];
    }
  }

  // Servicio: añadir soporte para AbortSignal
  async loadMessagesConversation(
    conversationId: string,
    endpoint: string = '/:userId/conversations/:id/messages',
    userId: string,
    signal?: AbortSignal

  ): Promise<string[]> {
    try {
      if (!conversationId) {
        console.warn('Llamada con conversationId vacío:', conversationId);
        return [];
      }
      const safeId = encodeURIComponent(conversationId);
      const uri = `${this.API_BASE}${endpoint.replace(':id', safeId).replace(':userId', userId)}`;
      console.log("Cargando mensajes de la conversación:", uri, ' raw id:', conversationId);

      const options: RequestInit = {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        signal,
        credentials: 'include'
      };

      const res = await this.fetchWithRetry(uri, options);

      if (!res.ok) {
        const errorText = await res.text();
        console.error("Error del backend:", res.status, errorText);
        throw new Error(`Error del backend: ${res.status} - ${errorText}`);
      }

      const response = await res.json();
      return response.messages;
    } catch (e: any) {
      // Detectar aborto de la petición
      if (e && (e.name === 'AbortError' || e.message === 'The user aborted a request.')) {
        console.warn('Fetch abortado para loadMessagesConversation id:', conversationId);
        return [];
      }
      console.error("Error en LMC:", e);
      console.log(`${this.API_BASE}${endpoint.replace(':id', conversationId)}`);
      return [];
    }
  } 

  // Eliminar una conversación por id
  async deleteConversation(conversationId: string, endpoint: string = '/:userid/conversations/:id', userId: string): Promise<boolean> {
    console.log("Eliminando conversación con id:", conversationId);
    try {
      const url = `${this.API_BASE}${endpoint.replace(':id', conversationId).replace(':userid', userId)}`;
      const options: RequestInit = {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        credentials: 'include'
      };

      const res = await this.fetchWithRetry(url, options);

      if (!res.ok) {
        const errorText = await res.text();
        console.error('Error al eliminar conversación:', res.status, errorText);
        return false;
      }
      return true;
    } catch (e) {
      console.error('Error en deleteConversation:', e);
      return false;
    }
  }

  // Nuevo método: Actualizar el título de una conversación
  async updateConversationTitle(conversationId: string, newTitle: string, endpoint: string = '/conversations/:id'): Promise<boolean> {
    console.log("Actualizando título de conversación:", conversationId, "nuevo título:", newTitle);
    try {
      const url = `${this.API_BASE}${endpoint.replace(':id', conversationId)}`;
      const options: RequestInit = {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({ title: newTitle }),
        credentials: 'include'
      };

      const res = await this.fetchWithRetry(url, options);

      if (!res.ok) {
        const errorText = await res.text();
        console.error('Error al actualizar título:', res.status, errorText);
        return false;
      }
      return true;
    } catch (e) {
      console.error('Error en updateConversationTitle:', e);
      return false;
    }
  }
}