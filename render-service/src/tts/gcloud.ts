import { TextToSpeechClient } from '@google-cloud/text-to-speech';

let clientPromise: Promise<TextToSpeechClient> | null = null;

const loadCredentialsFromEnv = (): Record<string, unknown> | undefined => {
  const b64 = process.env.GOOGLE_TTS_CREDENTIALS_BASE64;
  if (b64) return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  return undefined;
};

export const getGCloudClient = (): Promise<TextToSpeechClient> => {
  if (!clientPromise) {
    clientPromise = Promise.resolve().then(() => {
      const credentials = loadCredentialsFromEnv();
      if (credentials) return new TextToSpeechClient({ credentials });
      // Falls back to GOOGLE_APPLICATION_CREDENTIALS path
      return new TextToSpeechClient();
    });
  }
  return clientPromise;
};

export const synthesizeGCloud = async (text: string, voiceName: string): Promise<Buffer> => {
  const client = await getGCloudClient();
  const [response] = await client.synthesizeSpeech({
    input: { text },
    voice: { name: voiceName, languageCode: 'vi-VN' },
    audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 24000 },
  });
  if (!response.audioContent) throw new Error('gcloud_no_audio_content');
  return Buffer.from(response.audioContent as string, 'base64');
};
