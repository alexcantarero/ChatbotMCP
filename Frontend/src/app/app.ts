import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatServiceComponent } from "./chatservice/chatservice";
import { AuthService } from './authservice/auth.service';

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule, ChatServiceComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {

  constructor(private auth: AuthService) {} // Creamos una instancia del AuthService

  private readonly API_BASE = '/api'; //Endpoint base para el proxy

  public username: string = ''; // Nombre de usuario
  public password: string = ''; // Contraseña
  public loggedIn: boolean = false; // Estado de autenticación (para decidir qué pantalla mostrar)
  public loginError: string = ''; // Mensaje de error de login

  ngOnInit() {
    const sessionRestored = this.auth.tryRestoreSession();
    if (sessionRestored) {
      this.loggedIn = true;
      this.username = this.auth.getUsername();
      console.log("App: Sesión restaurada automáticamente");
    }
  }

  get token(): string { //Accede a authservice y obtiene el token si lo necesita.

    return this.auth.getToken();
  }

  // Gestión de registro. Se crea un usuario nuevo con los datos introducidos y automáticamente se inicia sesión.
  signIn() {
    console.log("Sign in clicked");
    try {
      fetch(`${this.API_BASE}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: this.username, password: this.password })
      }).then(async res => {
        if (res.ok) {
          console.log("User created successfully, proceeding to login");
          this.login(); //Si el usuario se crea correctamente, procedemos a iniciar sesión.
        } else {
          const errorBody = await res.json(); // Obtenemos el cuerpo del error
          const errorText = errorBody?.error || 'Unknown error'; //Aquí normalmente viene una descripción del error desde el backend.
          this.loginError = `Sign in error: ${errorText}`;
        }
      });
    }
    catch (e) {
      console.error("Error during sign in:", e);
    }
  }

  login() { // Gestión de inicio de sesión. Se ejecuta cuando se pulsa el botón de envío.
    if (this.username && this.password) { //Si los campos presentan información ...
      fetch(`${this.API_BASE}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username: this.username, password: this.password })
        }).then(async res => { //Hacemos petición al backend
          if (res.ok) {
            this.loggedIn = true; //Nos hemos logueado sin errores
            this.loginError = '';
            const body = await res.json();
            const token = body?.result.token || ''; //Obtenemos el token de la respuesta
            const userId = body?.result.userId || ''; //Obtenemos el userId de la respuesta
            
            // Guardar en AuthService tanto token como userId para poder usarlos en otros componentes
            this.auth.setToken(token);
            this.auth.setUserId(userId);
            this.auth.setUsername(this.username);
            
            console.log("User ID:", userId);
            console.log("Token:", token);
            console.log("Username:", this.username);
            
          } else {
            const errorBody = await res.json(); // Obtenemos el cuerpo del error
            const errorText = errorBody?.error || 'Unknown error'; //Aquí normalmente viene una descripción del error desde el backend. (si algún campo es incorrecto)
            this.loginError = `Authentication error: ${errorText}`;
          }
        }).catch(e => {
          this.loginError = `Network error: ${e.message}`;
        });

      
    }
    else {
      this.loginError = 'Invalid credentials. Please provide a username and password.'; //Si falta, se incluye aquí el error.
    }
  }

  logout() { //Cierre de sesión
    this.loggedIn = false; //Ya no estamos logueados
    this.username = ''; //Vaciamos campos
    this.password = '';
    this.loginError = '';
    this.auth.clearAuth(); // Limpia tanto userId como token del sistema de auth para poder cambiarlos por el del usuario nuevo.
  }

  // Devuelve una versión truncada (...) del token para mostrarla en el navegador y testear la API
  get maskedToken(): string {
    const token = this.auth.getToken();
    if (!token) return '';
    if (token.length <= 16) return token.replace(/.(?=.{4})/g, '*'); //Un poco de RegEX
    const start = token.slice(0, 8); //Del inicio al octavo carácter
    const end = token.slice(-4); //Los últimos cuatro caracteres
    return `${start}…${end}`; //Puntitos por medio
  }

  // Copiar token completo al portapapeles. Se ejecuta cuando se hace clic en el botón correspondiente.
  async copyToken(): Promise<void> {
    const token = this.auth.getToken(); //Obtenemos el token completo
    if (!token) {
      console.warn('No hay token disponible para copiar');
      return;
    }
    try {
      await navigator.clipboard.writeText(token); // Copia en el portapapeles
      console.debug('Token copiado al portapapeles');
    } catch (e) {
      console.warn('No se pudo copiar el token', e);
    }
  }
}