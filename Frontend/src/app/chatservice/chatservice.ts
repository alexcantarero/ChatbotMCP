import { Component, ViewChildren, ViewChild, QueryList, ElementRef, AfterViewInit, OnInit, ChangeDetectorRef, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MarkdownModule } from 'ngx-markdown';
import { ChatService } from '../controllers/chatserviceController';
import { AuthService } from '../authservice/auth.service';
import * as echarts from 'echarts';
import * as L from 'leaflet';
import { bounds, map, MarkerOptions } from 'leaflet';
import 'leaflet.geodesic';

export const DEFAULT_LAT = 41.38879;
export const DEFAULT_LON =  2.15899;

//Para configurar la chincheta del mapa de Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'assets/marker-icon-2x.png',
  iconUrl: 'assets/marker-icon.png',
  shadowUrl: 'assets/marker-shadow.png',
});

// Interfaz para representar una conversación
interface Conversation {
  id: string;
  date: Date;
  title?: string;
}

@Component({ //Creamos un componente para el chat. Esto luego va en el html en conjunto con su css.
  selector: 'app-chatservice',
  standalone: true,
  imports: [CommonModule, FormsModule, MarkdownModule],
  templateUrl: './chatservice.html',
  styleUrl: './chatservice.css',
  encapsulation: ViewEncapsulation.None  // Para que los estilos dinámicos de leaflet se puedan aplicar (e.g L.divIcon)
})
export class ChatServiceComponent implements OnInit {
  messages: { role: 'user'|'assistant' | 'ai'; text: string; hasChart?: boolean }[] = []; //Array de mensajes : rol, texto y si tiene gráfico o no
  message = ''; //Mensaje a enviar
  loading = false; //Estado de carga (esperando a la respuesta del LLM)
  error = ''; //Cualquier error que pueda surgir
  userId = ''; //ID del usuario autenticado

  conversations: Conversation[] = []; //Array de conversaciones del usuario
  currentConversationId: string | null = null; //id de la conversación actual

  showNewConversationModal = false; //Mostrar modal de nueva conversación ( al pulsar el botón + )
  newConversationTitle = ''; string = ''; //Título de la nueva conversación
  windowTitle = ""; // Título de la ventana (nueva conversación o editar título)

  @ViewChildren('chartContainer') chartContainers!: QueryList<ElementRef>; //Lista de chartContainers para renderizar gráficos
  @ViewChild('messagesContainer') private messagesContainer!: ElementRef; //Lista de mensajes para hacer scroll

  @ViewChildren('mapContainer') mapContainers!: QueryList<ElementRef>; //Las lista de los mapContainers de las conversaciones

  constructor(private chat: ChatService, private cdr: ChangeDetectorRef, private auth: AuthService) {}

  async ngOnInit() { //Función que se ejecuta al iniciar el componente
    this.conversations = []; // Vaciamos las conversaciones, mensajes y userId
    this.messages = [];
    this.userId = '';
    this.userId = await this.auth.getUserId(); //Recogemos el userId del AuthService
    console.log("chatservice.ts: User ID on init:", this.userId);
    await this.loadAllConversations(); //Cargamos todas las conversaciones del usuario en cuestión
    console.log("Conversaciones cargadas:", this.conversations);
    this.currentConversationId = this.conversations.length > 0 ? this.conversations[0].id : null; //Asignamos la primera conversación como la actual si existe alguna
    console.log("ID de la conversación actual:", this.currentConversationId); 
    if (this.currentConversationId) { //Si existe una conversación actual ...
      await this.loadMessagesConversation(this.currentConversationId); //Hay que cargar los mensajes de ésta
    } else {
      console.warn('No hay conversaciones; no se llamará a loadMessagesConversation con id nulo.');
    }
  }
  
  scrollToBottom(): void { //Función que hace scroll hasta el último mensaje cuando se añade uno nuevo.
    const container = this.messagesContainer.nativeElement; //Recuperamos el contenedor de mensajes
    container.scrollTop = container.scrollHeight; //Scroll hasta el final
  }

  //Mostrar pantallita de nueva conversación
  showCreateNewConversationModal() {
    this.showNewConversationModal = true;
    this.newConversationTitle = '';
    this.windowTitle = "New Conversation";
  }

  //Ocultar pantallita de nueva conversación / editar título de conversación
  cancelNewConversation() {
    this.showNewConversationModal = false;
    this.newConversationTitle = '';
  }

  //Mostrar pantallita de editar título de conversación
  showEditConversationTitleModal() {
    this.showNewConversationModal = true;
    this.newConversationTitle = this.getCurrentConversationTitle();
    this.windowTitle = "Edit Title";
  }

  // Obtener el título de la conversación actual
  getCurrentConversationTitle(): string {
    const conv = this.conversations.find(c => c.id === this.currentConversationId);
    return conv ? conv.title || 'Untitled' : 'Untitled';
  }

  // El LLM trae un objeto JSON con el gráfico. Esta función obtiene el texto del objeto dentro del mensaje.
  getOptionChartText(text: string): string {

    // Buscar el primer '{' y el último '};' o '}'
    const openBraceIdx = text.indexOf('{');
    if (openBraceIdx === -1) return '';
    let optionText = text.slice(openBraceIdx);
    
    // Buscar el cierre de la llave. Voy agrupando llaves, hasta encontrar la que cierra la primera.
    // En ese momento, corto el string para incluir el último }.
    
    let braceCount = 0;
    let endIdx = -1;
    for (let i = 0; i < optionText.length; i++) {
      if (optionText[i] === '{') braceCount++;
      if (optionText[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }
    
    if (endIdx === -1) return ''; //Si por alguna razón no se encuentra el cierre.
    
    optionText = optionText.slice(0, endIdx).trim(); // Cortamos hasta el cierre de la llave
    console.log('Opción extraída en getOptionChartText():', optionText);
    return optionText;
  }

  getOptionChartObject(text: string): any { //Obtiene el objeto con las opciones del gráfico.
    try {
      let optionText = this.getOptionChartText(text); //Primero obtenemos el json en formato texto, extraido del mensaje.
      
      if (!optionText) {
        throw new Error('No se encontró el objeto option en el texto');
      }
        
      // Eliminamos saltos de línea y backticks si existen
      optionText = optionText.replace(/```/g, '').replace(/\n/g, ' ').replace(/\r/g, '');
      
      let objectOption: any;

      console.log('Texto de opción de gráfico antes de parsear:', optionText);
    
      /// Quizás debería cambiar el eval, porque es inseguro. Si contiene código malicioso, se ejecutaría.
      objectOption = eval('(' + optionText + ')'); //Parseamos el objeto.
      
      console.log('Objeto de opción de gráfico parseado:', objectOption);
      return objectOption; // Lo devolvemos.
    } catch (error) {
      console.error('Error al parsear la opción del gráfico:', error);
      throw error;
    }
  }

  getMapOptions(text: string): any {
    try {
      let optiontext = text.slice(text.indexOf('results = ') + 9, text.indexOf(']') + 1); //Extraemos el substring que contiene los hoteles
      optiontext = optiontext.replace(/```/g, '').replace(/\n/g, ' ').replace(/\r/g, '').trim(); //Limpiamos el string
      console.log('Texto de opción de mapa antes de parsear:', optiontext);
      let objectOption = eval('(' + optiontext + ')')
      return objectOption; //Parseamos el JSON y lo devolvemos
    }
    catch (error) {
      console.error('Error al parsear la opción del mapa:', error);
      throw error;
    }
  }

  // Verificar si un mensaje tiene gráfico. Usada desde el html para saber si renderizar el gráfico o no
  hasChart(messageText: string): boolean {
    return messageText.includes('option = ');
  }

  // Verificar si un mensaje tiene mapa. Usada desde el html para saber si renderizar el mapa o no
  hasMap(messageText: string): boolean {
    return messageText.includes('results = ')
  }

  // Renderizar todos los gráficos después de que la vista se ha actualizado
  renderAllCharts() {
    this.chartContainers.forEach((container, index) => { //Por cada chartContainer que había en el html
      const messageIndex = parseInt(container.nativeElement.getAttribute('data-index'), 10); //El diez para convertirlo a decimal
      /*El resumen de esta instrucción es --> Accede al chartContainer, obtiene el índice almacenado (id del mensaje en la lista)
        y luego lo transforma a número entero con la función parseInt, para después poder buscar el mensaje correspondiente.*/
      const messageWithChart = this.messages[messageIndex]; // Obtener el mensaje a través del índice calculado.
      
      console.log(`Renderizando gráfico ${index} para el mensaje ${messageIndex}:`, messageWithChart?.text?.substring(0, 50));

      if (messageWithChart && this.hasChart(messageWithChart.text)) { //Si hemos encontrado el mensaje correctamente y tiene gráfico (con la función hasChart)
        try {
          const option = this.getOptionChartObject(messageWithChart.text); //Obtenemos el option del mensaje
          console.log('Opción de gráfico para renderizar:', option);
          const chartInstance = echarts.init(container.nativeElement); //Inicializamos el gráfico
          chartInstance.setOption(option); //Establecemos las options
          
          window.addEventListener('resize', () => { // Hacemos que sea responsive
            chartInstance.resize();
          });
        } catch (error) {
          console.error(`Error al renderizar el gráfico ${index}:`, error);
        }
      }
    });
  }

  // Renderizar todos los mapas después de que la vista se haya actualizado
  renderAllMaps() {
    
    this.mapContainers.forEach((container, index) => { //Por cada mapContainer que había en el html
      const messageIndex = parseInt(container.nativeElement.getAttribute('data-index'), 10); //Lo mismo que con los gráficos
      const messageWithMap = this.messages[messageIndex]; // Obtener el mensaje a través del índice calculado.
      var bounds = L.latLngBounds([]); //Creamos los límites del mapa para que quepa todo.
      console.log(`Renderizando mapa ${index} para el mensaje ${messageIndex}:`, messageWithMap?.text?.substring(0, 50), `con rol: ${messageWithMap?.role}`);

      if (messageWithMap && this.hasMap(messageWithMap.text)) { //Si hemos encontrado el mensaje correctamente y es del asistente
        try {
          //Vamos a extraer las distintas chinchetas del mensaje.

          let options = this.getMapOptions(messageWithMap.text); //Obtenemos el array de hoteles/actividades del mensaje
          console.log('Lista de hoteles/actividades extraída para el mapa:', options);

          var myIcon = L.icon({ //El icono. Para los hoteles, rojo; para las actividades, azul.
              iconUrl: options[0].bookingLink?'https://image2url.com/images/1763639874080-325faeb9-d82c-4639-b37a-1e58bbc89a73.png':'https://image2url.com/images/1763639495142-fc494dc3-38fe-4592-b94e-865d76fbe16c.png',
              iconSize: [32, 56],
          });
          let map = L.map(container.nativeElement).setView([options[0].latitude, options[0].longitude], 15); //Creamos el mapa para los hoteles/actividades
          if (options[0].originIATA) this.renderFlightPath(map, options); //Si es un mapa de vuelos, dibujamos la ruta y salimos de aquí.
          else{

            // La api a veces nos da coordenadas idénticas para varios hoteles/actividades, lo que hace que sólo se vea la primera chincheta.
            // Así que lo que hacemos es detectar aquellos que están repetidos y aplicarles un pequeño desplazamiento en círculo alrededor del punto original.
            const coordCounts = new Map<string, number>();

            for (let result of options) { //Por cada hotel/actividad del array
              //Añadimos una chincheta por cada hotel/actividad
              let settings : MarkerOptions = {riseOnHover: true, icon: myIcon}; //Configuración del marcador: seteamos el icono previo y que suba al pasar el ratón por encima.
              console.log('Añadiendo marcador en el mapa para:', result.name);
              
              // Crear clave única para las coordenadas
              const coordKey = `${result.latitude},${result.longitude}`;
              const count = coordCounts.get(coordKey) || 0;
              coordCounts.set(coordKey, count + 1); //Para este par de coordenadas, aumentamos el contador.
              
              let lat = result.latitude;
              let lng = result.longitude;
              if (count > 0) { //Si hay más de una chincheta con las mismas coordenadas ...
                // Desplazamiento en círculo alrededor del punto original
                const angle = (count * 360 / 8) * (Math.PI / 180); // 8 posiciones máximas
                const offset = 0.0005; // ~55 metros de desplazamiento
                lat += offset * Math.cos(angle);
                lng += offset * Math.sin(angle);
              }
              
              bounds.extend([lat, lng]); //Extendemos los límites del mapa para que quepa este punto
              L.marker([lat, lng], settings).addTo(map) //Añadimos el marcador al mapa, con su latitud y longitud
              .bindPopup(`
                <div style="text-align: center;">
                  <b>${result.name}</b><br> 
                  <t>${result.price ? result.price : result.address}</t>
                  <br>
                  ${result.price && result.bookingLink
                    ? `<a href="${result.bookingLink}" target="_blank">Book Now</a>` 
                    : `<a href="http://maps.google.com/maps?z=12&t=m&q=loc:${result.latitude}+${result.longitude}" target="_blank">See in Maps</a>`
                  }
                </div>
              `); //Le ponemos el nombre. Luego si es actividad, su precio; y si es hotel su dirección. 
                  // Finalmente, si es actividad y tiene su link de reserva, lo ponemos también. Si es hotel o actividad sin link, ponemos su localización.
            }

          }
          // Integración con una capa de Google Maps. Para que su aspecto sea como navegar por Google Maps.
          L.tileLayer('http://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',{
            maxZoom: 19,
            subdomains:['mt0','mt1','mt2','mt3'],
            attribution: '@ OpenStreetMap contributors'
          }).addTo(map); //No olvidarse de poner el addto(map) para añadir todo lo que hemos creado al mapa

            setTimeout(() => map.invalidateSize(), 100);

            if (bounds.isValid()) {
              map.fitBounds(bounds, {
              padding: [50, 50], //Padding de 50 píxeles alrededor de cada uno de los puntos.   
              maxZoom: 15,
            }); //Ajustamos el zoom y la posición del mapa para que se vea todo el recorrido
          }
        }
        catch (error) {
          console.error(`Error al renderizar el mapa ${index}:`, error);
        } 
      }
    });
  }

  // Función para renderizar la ruta de vuelo en el mapa.
  renderFlightPath(map: L.Map, options: any[]) {
  
    let length = options.length;
    const bounds = L.latLngBounds([]); //Creamos los límites del mapa para que quepa todo.

    for (let i = 0; i < length; i++) { //Por cada vuelo dentro del recorrido ...

      var myIcon = L.divIcon({ //Creamos un icono numerado para cada punto del vuelo
        className: 'custom-numbered-icon',
        html: `<div class="numbered-marker">${i+1}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });
      let settings : MarkerOptions = {riseOnHover: true, icon: myIcon};

      const latLng = L.latLng(options[i].latitude, options[i].longitude);
      bounds.extend(latLng); //Extendemos los límites del mapa para que quepa este punto

      if(options[i].originIATA){ //Si es el aeropuerto de origen
        L.marker(latLng, settings).addTo(map) //Creamos un marcador en el mapa con el icono numerado y su latitud y longitud.
        .bindPopup(`
          <div style="text-align: center;">
            <b>${options[i].originIATA}</b><br>
          </div>
        `);
      }
      else if(options[i].destinationIATA){ //Si es el aeropuerto de destino
        L.marker(latLng, settings).addTo(map)
        .bindPopup(`
          <div style="text-align: center;">
            <b>${options[i].destinationIATA}</b><br>
          </div>
        `);
        const from = [options[i-1].latitude, options[i-1].longitude]; //Dibujamos una línea geodésica entre el punto anterior y el actual
        const to = [options[i].latitude, options[i].longitude];
        const geodesic = new L.Geodesic([from, to]).addTo(map);

      }
      else{ //Si no, significa que es una de las escalas entre el origen y el destino
        
        L.marker(latLng, settings).addTo(map)
        .bindPopup(`
          <div style="text-align: center;">
            <b>${options[i].layoverIATA}</b><br>
          </div>
        `);
        const from = [options[i-1].latitude, options[i-1].longitude]; //También dibujamos la línea geodésica entre el punto anterior y el actual
        const to = [options[i].latitude, options[i].longitude];
        const geodesic = new L.Geodesic([from, to]).addTo(map);

      }
    }
    // Ajustamos el zoom del mapa para mostrar todos los puntos
    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        padding: [50, 50], //Padding de 50 píxeles alrededor de cada uno de los puntos.   
        maxZoom: 6
      }); //Ajustamos el zoom y la posición del mapa para que se vea todo el recorrido
    }
  }

  // Cargar todas las conversaciones del usuario en concreto
  async loadAllConversations() {
    this.conversations = []; //Vaciamos el array primero por si acaso
    const loadedConversations = await this.chat.loadAllConversations('/:userid/conversations', this.userId); //Llamamos al endpoint
    loadedConversations.forEach((conv: any) => { //Por cada conversación que nos ha devuelto ...
      const conversation: Conversation = { //Creamos una instancia de Conversation con su información
        id: conv._id,
        date: new Date(conv.conversationDateStarted),
        title: conv.title || `Conversación ${this.conversations.length + 1}`
      };
      this.conversations.push(conversation); // Y la añadimos al array de conversaciones
    });
  }
// Cargar todos los mensajes de una conversación concreta
  async loadMessagesConversation(conversationId: string) {
    this.messages = []; //Vaciamos el array de mensajes por si acaso
    console.log("ConversationId prepairing to be loaded:", conversationId);
    const loadedMessages = await this.chat.loadMessagesConversation(conversationId, '/:userId/conversations/:id/messages', this.userId); // Llamamos al endpoint
    loadedMessages.forEach((msg: any) => { //Por cada mensaje que nos ha devuelto
      this.messages.push({ // Añadimos al array de mensajes de la conversación el texto y el rol
        role: msg.role, 
        text: msg.content,
      });
    });
    console.log(loadedMessages);
    if (this.messages.length === 0) {
      this.error = "No hay mensajes en esta conversación.";
    }
    else this.error = '';
    // Renderizar gráficos después de cargar los mensajes
    this.cdr.detectChanges();
    setTimeout(() => { this.renderAllCharts(); this.renderAllMaps(); }, 100);
  }

  // Crear una nueva conversación
  async createNewConversation() {
    try {
      const conversationId = await this.chat.createNewConversation(':userId/conversations', this.newConversationTitle, this.userId); // Llamamos al endpoint
      console.log("ID de la nueva conversación:", conversationId);
      
      const newConversation: Conversation = { //Creamos una nueva instancia de Conversation con su información correspondiente
        id: conversationId,
        date: new Date(),
        title: this.newConversationTitle.trim()
      };
      this.conversations.push(newConversation); //Añadimos la nueva conversación al array de conversaciones
      console.log("Conversaciones actuales:", this.conversations);
      this.selectConversation(conversationId); //La seleccionamos como activa
      this.showNewConversationModal = false; // Desactivamos el modal (pantallita de crear nueva conversación)
      this.newConversationTitle = ''; //Vaciamos el título que almacena el nombre de la nueva conversación (ya no estamos creando ninguna)

    } catch (error) {
      console.error("Error al crear nueva conversación:", error);
      this.error = "Error al crear nueva conversación";
    }
  }

  // Seleccionar una conversación como activa
  async selectConversation(conversationId: string) {
    if (!conversationId) return;

    this.currentConversationId = conversationId; //Cambiamos el id de la conversación actual
    console.log('selectConversation: cambiado currentConversationId a', this.currentConversationId);

    this.messages = []; //Vaciamos el array de mensajes, porque se llenará ahora con los de la conversación seleccionada

    await this.loadMessagesConversation(this.currentConversationId) //Cargamos los mensajes de la conversación seleccionada

    /*
    const loadedMessages = await this.chat.loadMessagesConversation(this.currentConversationId, '/:userId/conversations/:id/messages', this.userId); //Cargamos los mensajes de la nueva conversación
    loadedMessages.forEach((msg: any) => { //Por cada mensaje que nos ha devuelto lo a
      this.messages.push({ 
        role: msg.role, 
        text: msg.content,
      });
    });
    
    console.log('selectConversation: mensajes cargados', loadedMessages);
    */

    // Renderizar gráficos después de cargar los mensajes
    this.cdr.detectChanges();
    //setTimeout(() => { this.renderAllCharts(); this.renderAllMaps(); }, 100);
  }

  // Eliminar una conversación
  async deleteConversation(conversationId: string, event?: Event, userId: string = this.userId) {
    if (event) event.stopPropagation(); // Para que no se dispare el selectConversation al borrar la conversación
    if (!conversationId) return;  

    const idx = this.conversations.findIndex(c => c.id === conversationId); //Buscamos el índice de la conversación actual a eliminar del array
    if (idx !== -1) {
      this.conversations.splice(idx, 1);
      this.conversations = this.conversations;
    }
    console.log('Conversación eliminada localmente. ID:', conversationId);
    const ok = await this.chat.deleteConversation(conversationId, '/:userid/conversations/:id', userId); // Llamamos al endpoint para eliminar la conversación en el backend
    if (!ok) {
      console.warn('La eliminación en el backend falló; considera recargar o revertir la UI.');
    }
    if (this.conversations.length > 0) {
      await this.selectConversation(this.conversations[0].id); //Seleccionamos la nueva conversación activa la primera del array
    } else {
      this.currentConversationId = null; //Si no quedan conversaciones, ponemos el id a null
      this.messages = []; //Y vaciamos los mensajes, porque si no hay conversaciones no hay mensajes que mostrar
    }
  }

  // Editar el título de una conversación
  async editConversationTitle(conversationId: string, event: Event) {
    event.stopPropagation(); // Para que no se dispare el selectConversation al editar el título y se quede un estado antiguo
    const newTitle = this.newConversationTitle //El nuevo título es el que hay en el input del modal
    if (newTitle && newTitle.trim().length > 0) { //Si el título no está vacío
      const success = await this.chat.editConversationTitle(conversationId, newTitle.trim(), ':userid/conversations/:id', this.userId); // Llamamos al endpoint
      if (success) {
        const conv = this.conversations.find(c => c.id === conversationId); //Buscamos la conversación en el array de conversaciones
        if (conv) {
          conv.title = newTitle.trim(); //Actualizamos el título
          console.log('Título de conversación actualizado localmente:', conv);
        }
          this.showNewConversationModal = false; //Cerramos el modal de editar título
          this.newConversationTitle = ''; //Vaciamos el título (ya no estamos editando ninguno)
      } else {
        this.error = 'Error al actualizar el título de la conversación.';
      }
    }
  }

  isActive(conversationId: string): boolean { // Para saber si la conversación que se está manda como parámetro es la activa
    return conversationId === this.currentConversationId;
  }

  activeConversationId(): string { // Para obtener el ID de la conversación activa
    return this.currentConversationId!;
  }

  actionToDo() { //Esta función se invoca al pulsar el botón de aceptar en el modal. Si estamos en el modal de nueva conversación se crea una nueva, y si estamos en el de editar, se edita el titulo.
    if (this.windowTitle === "New Conversation") { //Redirigimos según el título del modal.
      this.createNewConversation();
    } else if (this.windowTitle === "Edit Title") {
      if (this.currentConversationId) {
        this.editConversationTitle(this.currentConversationId, new Event('click'));
      }
    }
  }

  formatDate(date: Date): string { //Formateo de la fecha mostrada en la lista de conversaciones
    const today = new Date(); //Fecha actual
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1); //Fecha de ayer
    
    const isToday = date.toDateString() === today.toDateString(); //Si la fecha del mensaje es igual a la de hoy
    const isYesterday = date.toDateString() === yesterday.toDateString(); //Si la fecha del mensaje es igual a la de ayer
    
    if (isToday) { //Si es hoy, concatenamos "Today" + la hora
      return `Today ${date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
    } else if (isYesterday) { //Si es ayer, concatenamos "Yesterday" + la hora
      return `Yesterday ${date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
    } else {
      return date.toLocaleDateString('es-ES', { 
        day: '2-digit', 
        month: '2-digit', 
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  } 

  //Enviar un mensaje. Se ejecuta al pulsar sobre el botón de enviar. Acto seguido, se conecta con el backend.
  async sendMessage(activeConversationId: string) {
    if (!this.message.trim()) return;
    const text = this.message.trim();
    this.messages.push({ role: 'user', text }); //Introducimos el mensaje en el array de mensajes.
    this.message = ''; //Vacío el campo de texto
    this.loading = true;
    this.error = '';
    if (!activeConversationId) { //Si por alguna razón no hay conversación activa, que no se envíe el mensaje
      this.error = "Error al enviar: No hay ninguna conversación activa.";
      this.loading = false;
      return;
    }

    try {
      const reply = await this.chat.sendMessage(text, activeConversationId, '/:userid/conversations/:id/messages', this.userId); //Esperamos el mensaje del backend
      this.messages.push({ //Lo introducimos en el array de mensajes.
        role: 'assistant', 
        text: reply,
      });

      if (this.currentConversationId) { //Si existe la conversación activa
        try {
          await this.loadMessagesConversation(this.currentConversationId); //Recargamos los mensajes de la conversación, para que aparezca el nuevo mensaje
          this.scrollToBottom(); //Scroll hasta el final, para ver el mensaje nuevo
        } catch (reloadErr) {
          console.warn('No se pudieron recargar los mensajes tras enviar:', reloadErr); 
        }
      } else { //Ha habido un error, no hay conversación activa
        console.warn('No hay conversationId activo; no se recargaron los mensajes tras enviar.');
      }

      // Actualizamos la fecha de la conversación, para que se muestre correctamente en la lista.
      try{
        await this.chat.updateConversationDate(this.currentConversationId!, ':userid/conversations/:id/date', this.userId);
        const conv = this.conversations.find(c => c.id === this.currentConversationId);
        if (conv) {
          conv.date = new Date(); //Actualizamos la fecha localmente también
        }
        console.log('Fecha de conversación actualizada localmente.');
      }
      catch(err){
        console.warn('No se pudo actualizar la fecha de la conversación:', err);
      }
      // Renderizar gráficos después de recibir un nuevo mensaje
      this.cdr.detectChanges();
    } catch (err: any) {
      this.error = err?.message ?? String(err);
    } finally {
      this.loading = false;
    }
  }
}

