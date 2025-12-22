import { Component, OnInit, ViewEncapsulation, ChangeDetectorRef } from '@angular/core';
import { Chat } from '../controllers/chatController';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MarkdownComponent } from 'ngx-markdown';


@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, MarkdownComponent],
  templateUrl: './chat.html',
  styleUrls: ['./chat.css', "./spinkit.min.css"],
  encapsulation: ViewEncapsulation.None,
})

export class ChatComponent implements OnInit {

  messageText: string = '';
  messagesNoMCP: any[] = [];
  messagesMCP: any[] = [];
  isLoading: boolean = false;
  conversations: any[] = []; // Conversaciones cargadas

  constructor(
    private chat: Chat,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.chat.login("alex", "12345").then((conversations) => {
      console.log("Login successful");
      this.conversations = conversations;
      
      // Call loadFirstConversation AFTER conversations are loaded
      this.loadFirstConversation();
    }).catch(error => {
      console.error("Login error:", error);
    });
  }

  async loadFirstConversation(): Promise<void> {

    let allMessagesNOMCP = this.conversations[0].messages
    let allMessagesMCP = this.conversations[1].messages
    this.chat.setConversationIDs(this.conversations[0]._id, this.conversations[1]._id);

    // Escogemos sólo los mensajes de role 'ai'.

    allMessagesNOMCP = allMessagesNOMCP.filter((msg: any) => msg.role === 'ai').map((msg: any) => {return {content: msg.content, usage: msg.usage}});
    allMessagesMCP = allMessagesMCP.filter((msg: any) => msg.role === 'ai').map((msg: any) => {return {content: msg.content, usage: msg.usage}});

    for (const msg of allMessagesNOMCP) {
      this.messagesNoMCP = [...this.messagesNoMCP, {respuesta: msg.content, usage: msg.usage}]; 
    }
    for (const msg of allMessagesMCP) {
      this.messagesMCP = [...this.messagesMCP, {respuesta: msg.content, usage: msg.usage}]; 
    } 

    this.cdr.detectChanges();

  }

  async sendMessage(): Promise<void> {
    if (!this.messageText.trim()) {
      return;
    }

    console.log("Sending message:", this.messageText);
    this.isLoading = true;
    this.cdr.detectChanges(); // Forzar actualización

    try {
      const res = await this.chat.sendMessageToGemini(this.messageText);
      console.log("Response received:", res);
      
      // Crear nuevos arrays en lugar de hacer push (mejor para detección de cambios)
      this.messagesNoMCP = [...this.messagesNoMCP, res.outputNoMCP];
      this.messagesMCP = [...this.messagesMCP, res.outputMCP];
      
      this.isLoading = false;
      this.cdr.detectChanges(); // Forzar actualización después de cambios
      
    } catch (error) {
      console.error("Error sending message:", error);
      this.messagesNoMCP = [...this.messagesNoMCP, 'Error sending message.'];
      this.messagesMCP = [...this.messagesMCP, 'Error sending message.'];
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  createNewConversations(): void {
    console.log("Creating new conversations...");
    this.chat.createConversations();

    //this.messagesNoMCP = [];
    //this.messagesMCP = [];
  }
}