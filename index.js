const express = require('express');
const axios = require('axios');
const cors = require('cors');
const mongoose = require('mongoose');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
};
app.use(cors(corsOptions));

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});
mongoose.connection.on('error', error =>
  console.error('MongoDB connection error:', error)
);
mongoose.connection.once('open', () => console.log('MongoDB connected.'));

const conversationSchema = new mongoose.Schema({
  question: String,
  answer: String,
  createdAt: { type: Date, default: Date.now }
});

const Conversation = mongoose.model('Conversation', conversationSchema);

// Load the bad words list from the JSON file
let badWords = [];
const badWordsFilePath = path.join(__dirname, 'bad_words.json');

// Synchronously read the file to ensure it is loaded before the server starts
try {
  const data = fs.readFileSync(badWordsFilePath, 'utf8');
  badWords = JSON.parse(data);
} catch (err) {
  console.error('Error loading bad words list:', err);
  process.exit(1); // Stop the process if the bad words list can't be loaded
}

// Censoring function using the loaded bad words list
function censorBadWords(text) {
  let censoredText = text;
  badWords.forEach(badWord => {
    const regex = new RegExp(`\\b${badWord}\\b`, 'gi');
    censoredText = censoredText.replace(regex, match => match.charAt(0) + '*'.repeat(match.length - 1));
  });
  return censoredText;
}

app.post('/api/chat', async (req, res) => {
  const { prompt } = req.body;
  const context = "You are Jesus. Give advice and answer questions as Jesus would, using biblical references when necessary. Provide thoughtful, compassionate, and wise counsel consistent with Christian teachings.";
  console.log(process.env.OPENAI_API_KEY);
  const headers = {
    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: "gpt-3.5-turbo",
      messages: [{ "role": "system", "content": context }, { "role": "user", "content": prompt }],
      max_tokens: 500 // This ensures the response is no more than 500 tokens
    }, { headers });

    // Get the uncensored message from OpenAI
    const uncensoredMessage = response.data.choices[0].message.content;

    // Censor the prompt and the OpenAI message before saving to the database
    const censoredQuestion = censorBadWords(prompt);
    const censoredAnswer = censorBadWords(uncensoredMessage);

    // Save the censored question and answer to the database
    const newConversation = new Conversation({ question: censoredQuestion, answer: censoredAnswer });
    await newConversation.save();

    // Send the uncensored OpenAI message to the user
    res.json({ message: uncensoredMessage });
  } catch (error) {
    console.error('OpenAI API error:', error.response?.data || error.message);
    res.status(500).send('Error processing your request');
  }
});

app.get('/api/conversation', async (req, res) => {
  try {
    const conversations = await Conversation.find({}).sort({ createdAt: -1 });
    res.json(conversations);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).send('Error fetching conversations');
  }
});

const cleanupThreshold = 10000;
async function cleanupOldConversations() {
  try {
    const count = await Conversation.countDocuments();
    if (count > cleanupThreshold) {
      const excess = count - cleanupThreshold;
      await Conversation.find().sort({ createdAt: 1 }).limit(excess).remove().exec();
      console.log(`Cleaned up ${excess} old conversations`);
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

cron.schedule('0 0 * * *', () => {
  console.log('Running daily cleanup task');
  cleanupOldConversations();
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});





