const express = require('express');
const axios = require('axios');
const cors = require('cors');
const mongoose = require('mongoose');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000' }));

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
mongoose.connection.on('error', error => console.error('MongoDB connection error:', error));
mongoose.connection.once('open', () => console.log('MongoDB connected.'));

const conversationSchema = new mongoose.Schema({
  question: String,
  answer: String,
  createdAt: { type: Date, default: Date.now },
});
const Conversation = mongoose.model('Conversation', conversationSchema);

let badWords = [];
try {
  const badWordsFilePath = path.join(__dirname, 'bad_words.json');
  const data = fs.readFileSync(badWordsFilePath, 'utf8');
  badWords = JSON.parse(data);
} catch (err) {
  console.error('Error loading bad words list:', err);
  process.exit(1);
}

function censorBadWords(text) {
  return badWords.reduce((censored, word) => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    return censored.replace(regex, (match) => match[0] + '*'.repeat(match.length - 1));
  }, text);
}

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
}));

app.post('/api/chat',
  body('prompt').trim().isLength({ min: 1 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const prompt = req.body.prompt;
    const context = "You are Jesus. Provide compassionate counsel consistent with Christian teachings using bilblical quotes when necessary but not always. Default answers to questions should be sarcastic, quick-witted advice and answer questions as Jesus would making responses light hearted, humorous and satirical, and liberal. If however a user asks a serious question about babies dying, cancer, then a more default Christian guidance and condolences should be given. If asked if you are ChatGPT, AI, or OpenAI, only respond that you are Jesus";
    const headers = {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    };

    try {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: "gpt-3.5-turbo",
        messages: [
          { "role": "system", "content": context },
          { "role": "user", "content": prompt }
        ],
        max_tokens: 300,
      }, { headers });

      const message = response.data.choices[0].message.content;
      const censoredAnswer = censorBadWords(message);
      const censoredPrompt = censorBadWords(prompt);
      const newConversation = new Conversation({ question: censoredPrompt, answer: censoredAnswer });
      await newConversation.save();

      res.json({ message: censoredAnswer });
    } catch (error) {
      console.error('OpenAI API error:', error.response?.data || error.message);
      res.status(500).send('Error processing your request');
    }
  }
);

app.get('/api/conversation', async (req, res) => {
  try {
    const conversations = await Conversation.find().sort({ createdAt: -1 });
    res.json(conversations);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).send('Error fetching conversations');
  }
});

const cleanupThreshold = 100;

async function cleanupOldConversations() {
  try {
    const count = await Conversation.countDocuments();
    if (count > cleanupThreshold) {
      const conversationsToDelete = await Conversation.find().sort({ createdAt: 1 }).limit(count - cleanupThreshold);
      const idsToDelete = conversationsToDelete.map(doc => doc._id);
      const deleteResult = await Conversation.deleteMany({ _id: { $in: idsToDelete } });
      console.log(`Cleaned up ${deleteResult.deletedCount} old conversations`);
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

cron.schedule('0 * * * *', () => {
  console.log('Running hourly cleanup task');
  cleanupOldConversations();
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});






