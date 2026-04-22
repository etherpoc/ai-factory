/**
 * Quick diagnostic: send 2 calls per model with the UAF preamble as a
 * cache_control'd system block and log raw response.usage.
 *
 * Goal: determine if Sonnet 4.6 fails to cache even with a fresh, minimal
 * call (isolating it from UAF's tool-use loop), or whether some part of our
 * code path suppresses caching only on Sonnet.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import 'dotenv/config';

async function main(): Promise<number> {
  const client = new Anthropic();
  const preamble = await readFile('agents/_common-preamble.md', 'utf8');

  // Token-count ground truth: let Anthropic tell us how many tokens the preamble is.
  let preambleTokens: number | undefined;
  try {
    const count = await client.messages.countTokens({
      model: 'claude-sonnet-4-6',
      system: [{ type: 'text', text: preamble, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'x' }],
    });
    preambleTokens = count.input_tokens;
    process.stdout.write(`preamble (incl. 1-char user msg): ${preambleTokens} tokens\n\n`);
  } catch (err) {
    process.stdout.write(`token count failed: ${String(err)}\n\n`);
  }

  const models = ['claude-sonnet-4-6'];

  // Same tool list structure we use in UAF claude strategy
  const tools = [
    {
      name: 'read_file',
      description: 'Read a UTF-8 file',
      input_schema: {
        type: 'object' as const,
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
    {
      name: 'list_dir',
      description: 'List a directory',
      input_schema: {
        type: 'object' as const,
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  ];

  for (const model of models) {
    for (const variant of ['no-tools', 'with-tools'] as const) {
      process.stdout.write(`=== ${model} / ${variant} ===\n`);
      for (const [i, label] of [
        [0, 'call-1 (expect cache_creation > 0)'],
        [1, 'call-2 (expect cache_read > 0)'],
      ] as const) {
        const req: Parameters<typeof client.messages.create>[0] = {
          model,
          max_tokens: 50,
          system: [
            { type: 'text', text: preamble, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: `You are the ${i}th diagnostic responder.` },
          ],
          messages: [{ role: 'user', content: 'reply with just: ok' }],
        };
        if (variant === 'with-tools') req.tools = tools;
        const res = (await client.messages.create(req)) as {
          usage: unknown;
          stop_reason: string | null;
        };
        process.stdout.write(
          `  ${label}\n    usage: ${JSON.stringify(res.usage)}\n    stop: ${res.stop_reason}\n`,
        );
      }
      process.stdout.write('\n');
    }
  }

  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  },
);
