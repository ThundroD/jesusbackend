const express = require('express');
const axios = require('axios');
const cors = require('cors');
const mongoose = require('mongoose');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet'); // Import Helmet
const rateLimit = require('express-rate-limit'); // Import express-rate-limit
const { body, validationResult } = require('express-validator'); // Import express-validator
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(helmet()); // Use Helmet to set secure HTTP headers

// CORS options
const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
};
app.use(cors(corsOptions));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});
mongoose.connection.on('error', error => console.error('MongoDB connection error:', error));
mongoose.connection.once('open', () => console.log('MongoDB connected.'));

// Define the conversation schema
const conversationSchema = new mongoose.Schema({
  question: String,
  answer: String,
  createdAt: { type: Date, default: Date.now }
});
const Conversation = mongoose.model('Conversation', conversationSchema);

// Load the bad words list
let badWords = [];
const badWordsFilePath = path.join(__dirname, 'bad_words.json');
try {
  const data = fs.readFileSync(badWordsFilePath, 'utf8');
  badWords = JSON.parse(data);
} catch (err) {
  console.error('Error loading bad words list:', err);
  process.exit(1);
}

// Censoring function
function censorBadWords(text) {
  let censoredText = text;
  badWords.forEach(badWord => {
    const regex = new RegExp(`\\b${badWord}\\b`, 'gi');
    censoredText = censoredText.replace(regex, match => match.charAt(0) + '*'.repeat(match.length - 1));
  });
  return censoredText;
}

// Set up rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// POST endpoint to get a chat response
app.post('/api/chat',
  body('prompt').trim().isLength({ min: 1 }).withMessage('Prompt must not be empty.'), // Validate and sanitize prompt
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const prompt = req.body.prompt;
    const context = "You are Jesus. Give sarcastic advice and answer questions as Jesus would, using biblical references when necessary. Provide compassionate counsel consistent with Christian teachings, but also make the responses humorous and satirically. If asked if you are ChatGPT, AI, or OpenAI, only respond that you are Jesus.";
    const headers = {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    };

    try {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: "gpt-3.5-turbo",
        messages: [{ "role": "system", "content": context }, { "role": "user", "content": prompt }],
        max_tokens: 300
      }, { headers });

      const uncensoredMessage = response.data.choices[0].message.content;
      const censoredQuestion = censorBadWords(prompt);
      const censoredAnswer = censorBadWords(uncensoredMessage);
      const newConversation = new Conversation({ question: censoredQuestion, answer: censoredAnswer });
      await newConversation.save();

      res.json({ message: uncensoredMessage });
    } catch (error) {
      console.error('OpenAI API error:', error.response?.data || error.message);
      res.status(500).send('Error processing your request');
    }
  }
);

// GET endpoint to retrieve conversation history
app.get('/api/conversation', async (req, res) => {
  try {
    const conversations = await Conversation.find({}).sort({ createdAt: -1 });
    res.json(conversations);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).send('Error fetching conversations');
  }
});

// Scheduled task to cleanup old conversations
const cleanupThreshold = 100; // Limit to 100 conversations

async function cleanupOldConversations() {
  try {
    const count = await Conversation.countDocuments();
    if (count > cleanupThreshold) {
      const excess = count - cleanupThreshold;
      // Use deleteMany() instead of remove() which is deprecated in newer mongoose versions
      await Conversation.find().sort({ createdAt: 1 }).limit(excess).deleteMany().exec();
      console.log(`Cleaned up ${excess} old conversations`);
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

// Schedule to run every hour ('0 * * * *')
cron.schedule('0 * * * *', () => {
  console.log('Running hourly cleanup task');
  cleanupOldConversations();
});


// Start the server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});






