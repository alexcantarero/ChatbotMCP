# Backend MCP Server 🛫

## 📝 Description

An intelligent flight information chatbot backend powered by AI. This project integrates:

• **Express Server**: Node.js backend for handling API requests
• **Database Integration**: 
  - MongoDB for chat history and user management
• **AI Integration**: 
  - Google Gemini AI for natural language processing
  - n8n workflow integration for enhanced AI capabilities
• **MCP Tools**: Model Context Protocol server providing:
  - Flight data retrieval and processing
  - Conversational context management
  - Authentication and authorization
  - Real-time data processing

## 🚀 Quick Start

### Preeequisiees

• Node.j  v18 or higher
• npm
• MongoDB running locally
• n8n server


### Installation & Running

1. Clone the repository:
```bash
git clone https://github.com/alexcantarero/EChartsMCPBackend.git
```

2. Navigate to the project directory:
```bash
cd EhhartsMCBackend
```

3. Install dependencies:
```bash
npm install
```

4. Configure environment variables:
Create a `.env` file with the following variables:
```env
GEMINI_API_KEY=your_gemini_api_key
N8N_WEBHOOK_URL=your_n8n_webhook_url
JWT_SECRET=your_jwt_secret
```

5. Start the server:
```bash
node src/js/app.js
```

6. The server will be running at `http://localhost:3001`

## 🛠️ Technologies

• Node.js
• Express
• MongoDB
• Google Gemini AI
• n8n
• Model Context Protocol
• JWT Authentication

## 📦 Features

• **Secure Authentication**:
  - JWT-based authentication
  - User session management
  - Protected API endpoints

• **Conversation Management**:
  - Create and manage chat sessions
  - Store conversation history
  - Handle user-specific contexts

• **AI Integration**:
  - Natural language processing with Gemini AI
  - Context-aware responses
  - Flight data interpretation

• **Database Operations**:
  - MongoDB for user and chat data
  - Efficient data retrieval and storage

• **API Endpoints**:
  - RESTful API design
  - Secure data transmission
  - Error handling and validation

## 🔗 API Endpoints

### Authentication
- `POST /auth/register` - Register new user
- `POST /auth/login` - User login

### Conversations
- `GET /conversations` - Get all user conversations
- `POST /conversations` - Create new conversation
- `GET /conversations/:id` - Get specific conversation
- `DELETE /conversations/:id` - Delete conversation
- `PUT /conversations/:id` - Update conversation title

### Messages
- `GET /conversations/:id/messages` - Get conversation messages
- `POST /conversations/:id/messages` - Send new message

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

This project is [MIT](LICENSE) licensed.