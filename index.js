const express = require('express');
const axios = require('axios');
const cors = require('cors');
const mongoose = require('mongoose');
const cron = require('node-cron');
require('dotenv').config();

const app = express();
app.use(express.json());

const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
};
app.use(cors(corsOptions));

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
mongoose.connection.on('error', error => console.error('MongoDB connection error:', error));
mongoose.connection.once('open', () => console.log('MongoDB connected.'));

const conversationSchema = new mongoose.Schema({
  question: String,
  answer: String,
  createdAt: { type: Date, default: Date.now }
});

const Conversation = mongoose.model('Conversation', conversationSchema);

app.post('/api/chat', async (req, res) => {
  const { prompt } = req.body;
  const context = "You are Jesus. Give advice and answer questions as Jesus would, using biblical references when necessary. Provide thoughtful, compassionate, and wise counsel consistent with Christian teachings.";

  const headers = {
    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: "gpt-3.5-turbo",
      messages: [{ "role": "system", "content": context }, {"role": "user", "content": prompt}],
    }, { headers });

    const message = response.data.choices[0].message.content;

    const newConversation = new Conversation({ question: prompt, answer: message });
    await newConversation.save();

    res.json({ message });
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





