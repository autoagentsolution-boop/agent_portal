// Live smoke test for the vendored image-gen module (A2). ONE real Nano Banana
// call (~$0.06) to prove the port works in-process and writes a PNG to disk.
// Run: npx tsx src/imagegen/verify-image-live.ts
import { stat } from 'node:fs/promises';
import { generate, IMAGE_OUTPUT_DIR } from './nano-banana.ts';
import { assetStore } from '../assets/store.ts';

async function main(): Promise<void> {
  console.log('output dir:', IMAGE_OUTPUT_DIR);
  const res = await generate({
    prompt:
      'A high-quality professional marketing image for a social post about an AI automation product. ' +
      'Clean modern composition, vibrant, brand-friendly, no text overlay.',
    mode: 'text-to-image',
  });
  console.log('result:', { imagePath: res.imagePath, cached: res.cached, ms: res.durationMs });
  const st = await stat(res.outputFile);
  if (st.size < 1000) throw new Error(`image too small (${st.size} bytes)`);
  console.log(`  ok   PNG written (${st.size} bytes)`);

  // Prove the `local:` AssetStore route reads the bytes a publisher would upload.
  const { bytes, contentType } = await assetStore.fetchBinary({ id: `local:${res.outputFile}` });
  if (bytes.length !== st.size) throw new Error('fetchBinary size mismatch');
  console.log(`  ok   AssetStore local: route returns ${bytes.length} bytes (${contentType})`);
  console.log('\nPASS — live image gen + local AssetStore route work');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAIL —', e instanceof Error ? e.message : e);
    process.exit(1);
  });
