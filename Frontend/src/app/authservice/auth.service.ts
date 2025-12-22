import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private userId = ''; // ID del usuario autenticado
  private token = ''; // Token de autenticación
  private username = ''; // Nombre de usuario
  private userIdResolve: ((id: string) => void) | null = null; // Función para resolver el promise cuando se establece el userId
  private userIdPromise!: Promise<string>; // Lo ponemos como promise para esperar a que se establezca el userId, y no hacer un get sin que esté seteado.

  constructor() {
    this.resetPromise(); // Inicializar la promesa al crear el servicio
  }

  private resetPromise() { // Reiniciar la promesa para esperar un nuevo userId. Se ejecuta al iniciar y al hacer logout.
    this.userIdPromise = new Promise((resolve) => { 
      this.userIdResolve = resolve;
    });
  }

  setUserId(id: string | null) { //Setear el userId cuando se inicia sesión.
    this.userId = id || '';
    console.log("AuthService: User ID set to", id);
    
    //Guardamos en el localstorage o lo eliminamos según corresponda
    if(this.userId) {
      localStorage.setItem('userId', this.userId);
    } else {
      localStorage.removeItem('userId');
    }
    
    if (this.userIdResolve) {
      this.userIdResolve(this.userId); // Creamos el promise para esperar al userId
    }
  }

  setUsername(name: string| null) { //Setear el nombre de usuario cuando se inicia sesión.
    this.username = name || '';
    console.log("AuthService: Username set to", name);
    if(this.username) {
      localStorage.setItem('username', this.username);
    }
  }

  setToken(token: string | null) { //Setear el token cuando se inicia sesión.
    this.token = token || ''; //Setear el token
    console.log("AuthService: Token set");

    if(token) {
      localStorage.setItem('token', this.token);
      localStorage.setItem('dateTokenExpiry', (Date.now() + 60*60*1000).toString()); // Guardamos la fecha de expiración (1 hora)
    } else {
      localStorage.removeItem('token');
    }
  }
  
  getUserId(): Promise<string> { 
    console.log("AuthService: Getting User ID", this.userId);
    if (this.userId) {
      return Promise.resolve(this.userId); // Si ya está seteado, devolverlo directamente
    }
    return this.userIdPromise; // Si no, esperar a que se setee
  }

  getUsername(): string {
    console.log("AuthService: Getting Username", this.username);
    return this.username;
  }

  getToken(): string {
    return this.token; // Devolver el token directamente
  }

  // Intentar restaurar la sesión desde el localStorage. Esto se hace si se cierra/recarga la página.
  tryRestoreSession(): boolean {
    const storedUserId = localStorage.getItem('userId'); //Obtenemos el userId
    const storedToken = localStorage.getItem('token'); //Obtenemos el token
    const storedUsername = localStorage.getItem('username'); //Obtenemos el nombre de usuario
    const timestamp = localStorage.getItem('dateTokenExpiry'); //Obtenemos la fecha de expiración del token

    if(timestamp && Date.now() > parseInt(timestamp)){
      this.clearAuth(); //Si ha expirado, limpiamos la auth y no restauramos la sesión
      return false;
    }

    if(storedUserId && storedToken && storedUsername){ //Los asignamos si existen, y damos como restaurada la sesión.
      this.userId = storedUserId;
      this.token = storedToken;
      this.username = storedUsername;
      if (this.userIdResolve) {
        this.userIdResolve(this.userId);
      }
      console.log("AuthService: Session restored from localStorage");
      console.log("AuthService: User ID:", this.userId);
      console.log("AuthService: Username:", this.username);

      return true
    }

    console.log("AuthService: Session NOT restored");
    return false;
  }

  // Limpiar al hacer logout
  clearAuth() {
    this.userId = ''; 
    this.token = '';
    this.userIdResolve = null;
    this.resetPromise();
    console.log("AuthService: User ID and Token cleared, promise reset");

    localStorage.removeItem('userId'); //Los eliminamos del localStorage, para así no volver a restaurar la sesión al recargar.
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('dateTokenExpiry');
  }
}