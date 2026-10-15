import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';

const contracts = [
  'MockUSDC',
  'MockUSDCFaucet',
  'LiquidVault',
  'TimedVault',
  'BoundraFactory',
  'BoundraExecutor',
];
const output = new URL('../src/abis/', import.meta.url);
const formatting = JSON.parse(
  readFileSync(new URL('../../../.prettierrc.json', import.meta.url), 'utf8'),
);
mkdirSync(output, { recursive: true });
for (const name of contracts) {
  const artifact = JSON.parse(
    readFileSync(
      new URL(`../../../contracts/out/${name}.sol/${name}.json`, import.meta.url),
      'utf8',
    ),
  );
  const source = `// Generated from Foundry artifacts. Run abi:generate after contracts:build.\nexport const ${name[0].toLowerCase() + name.slice(1)}Abi = ${JSON.stringify(artifact.abi, null, 2)} as const;\n`;
  writeFileSync(
    new URL(`${name}.ts`, output),
    await format(source, { ...formatting, parser: 'typescript' }),
  );
}
console.log(`Exported ${contracts.length} typed ABIs to ${fileURLToPath(output)}`);
