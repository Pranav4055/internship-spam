import mongoose from 'mongoose';
import { createApp } from './app.js';
import { config } from './config.js';
import { connectToDatabase } from './db/connect.js';

await connectToDatabase();

const server = createApp().listen(config.port, () => {
  console.info(`InternShield server listening on port ${config.port}.`);
});

async function shutdown() {
  server.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
