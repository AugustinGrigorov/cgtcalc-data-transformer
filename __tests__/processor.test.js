const IIParser = require('../ii');
const iiTestData = require('./data/ii.json');

const FreetradeParser = require('../freetrade');
const freetradeTestData = require('./data/freetrade.json');

const FidelityParser = require('../fidelity');
const fidelityTestData = require('./data/fidelity.json');

const BullionVaultParser = require('../bullionvault');
const bullionvaultTestData = require('./data/bullionvault.json');

const processors = [
  { name: 'ii', processor: new IIParser(), testData: iiTestData },
  { name: 'freetrade', processor: new FreetradeParser(), testData: freetradeTestData },
  { name: 'fidelity', processor: new FidelityParser(), testData: fidelityTestData },
  { name: 'bullionvault', processor: new BullionVaultParser(), testData: bullionvaultTestData },
]

processors.forEach(({ name, processor, testData }) => {
  describe(name, () => {
    describe('parseToFormat', () => {
      testData.forEach(({ name, input, expected }) => {
        it(name, async () => {
          const results = await processor.parseToFormat(input);
          expect(results).toEqual(expected);
        });
      });
    });
  });
});