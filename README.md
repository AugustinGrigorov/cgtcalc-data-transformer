# cgtcalc-data-transformer

Parsers that convert broker CSVs and BullionVault "Dealing advice" email notifications into the `cgtcalc` input format.

This repository prepares input data for the cgtcalc tool: https://github.com/mattjgalloway/cgtcalc

IMPORTANT DISCLAIMER
--------------------
Most of the code in this repository was generated or significantly modified by an AI assistant. I accept no responsibility for the correctness of parsing logic or the accuracy of any financial data produced by these scripts. Use this code at your own risk and always verify outputs before including them in financial reporting or tax returns.

USAGE
-----
Run the parsers from the repository root. Examples:

```bash
node index.js freetrade data/freetrade_all-time.csv
node index.js ii data/ii_2024.csv
node index.js fidelity data/fidelity_all_time.csv
node index.js bullionvault path/to/dealing-advice-emails
```

The parsers output normalized transaction lines into `data.txt` (this file is ignored by git by default).

Supported services and required inputs
-------------------------------------
This project includes parsers for the following services. For every parser you must provide the input the service offers (CSV export or a folder of email files):

- BullionVault (CLI type: `bullionvault`)
	- Input: a folder containing BullionVault "Dealing advice" email files saved as `.eml` (raw email files).

- Freetrade (CLI type: `freetrade`)
	- Input: CSV export of your transactions (downloadable from the Freetrade app).

- Interactive Investor / II (CLI type: `ii`)
	- Input: CSV export of your transactions (downloadable from the ii website).

- Fidelity International (CLI type: `fidelity`)
	- Input: CSV export of your transactions from Fidelity International (downloadable from the Fidelity International website).

Notes and safety
----------------
- Keep all downloaded CSVs and email files out of version control. `.gitignore` already contains `data/`.
- Always verify the produced `data.txt` before feeding it to `cgtcalc` or using it for tax reporting.

License
-------
This project is licensed under the MIT License. See `LICENSE` for details.
