#!/usr/bin/env node

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function main() {
  const input = await readStdin();
  console.log(JSON.stringify({ received: input || '(empty)' }));
}

main();
