import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import mic from "mic";
import { Readable } from "stream";
import readline from "readline";
import ora from "ora";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import axios from "axios";

import { Configuration, OpenAIApi } from "openai";
const configuration = new Configuration({
  apiKey: "XXX",
});
const openai = new OpenAIApi(configuration);
ffmpeg.setFfmpegPath(ffmpegPath.path);

const webhookUrl = "XXXXXXXXXX";

const today = new Date().toISOString();
const weekday = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const d = new Date();
const day = weekday[d.getDay()];

const customPrompt = `
I will send you a text from a voice-to-text transcription. The text will include a task and possibly a description and a due date.
I want you to interpret what should be the task title, what should be the description (if any) and what is the due date. The date may be relative, so I'll provide you what is today's date in ISO format: ${today}.
Today is ${day}.

I want you to respond with a JSON object with the following structure. Don't include anything more in the response. It should start with { and end with }:
{
    "title": "<task title>",
    "description": "<task description or empty string>",
    "due": "due date in ISO format or empty string"
}
If the provided text is not a task, respond with null.
The text can be in English or Polish, please respond in the same language as the text.

The text is:
`;

async function sendToWebhook(data) {
  try {
    await axios.post(webhookUrl, JSON.parse(data));
  } catch (error) {
    console.error("Error sending data to webhook:", error);
    throw error;
  }
}

async function generateGptResponse(prompt) {
  const gptResponse = await openai.createCompletion({
    prompt,
    model: "text-davinci-003",
    temperature: 0.3,
    max_tokens: 500,
  });

  return gptResponse.data.choices[0].text;
}

function recordAudio(filename) {
  return new Promise((resolve, reject) => {
    const micInstance = mic({
      rate: "16000",
      channels: "1",
      fileType: "wav",
    });

    const micInputStream = micInstance.getAudioStream();
    const output = fs.createWriteStream(filename);
    const writable = new Readable().wrap(micInputStream);

    console.log(
      "Press ENTER to start recording and then press ENTER again to stop recording."
    );

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("", async () => {
      console.log("Recording...");
      const recordingSpinner = ora("Recording in progress...").start();
      writable.pipe(output);
      micInstance.start();

      rl.once("line", () => {
        micInstance.stop();
        recordingSpinner.stop();
        console.log("Finished recording");
        rl.close();
        resolve();
      });

      micInputStream.on("error", (err) => {
        reject(err);
      });
    });
  });
}

async function transcribeAudio(filename) {
  const transcript = await openai.createTranscription(
    fs.createReadStream(filename),
    "whisper-1"
  );
  return transcript.data.text;
}

async function main() {
  const audioFilename = "recorded_audio.wav";
  await recordAudio(audioFilename);
  const transcribingSpinner = ora("Transcribing audio...").start();
  const transcription = await transcribeAudio(audioFilename);
  transcribingSpinner.stop();
  console.log("Transcription:", transcription);

  const fullPrompt = customPrompt + transcription;
  const gptSpinner = ora("Generating GPT-3 response...").start();
  const gptResponse = await generateGptResponse(fullPrompt);
  gptSpinner.stop();
  console.log("GPT-3 Response:", gptResponse);

  const webhookSpinner = ora("Adding task to Todoist...").start();
  await sendToWebhook(gptResponse);
  webhookSpinner.stop();
  console.log("Task added to Todoist!");
}

main();
