# wafflebase

Wafflebase is a simple spreadsheet for large-scale data processing and analysis.

## Setting Development Environment

### Prerequisites

You need to have the following software installed on your system:

- [Node.js](https://nodejs.org/en/) (version 18 or later)

### Building & Testing

```bash
npm install
npm run build
npm test
```

### Running

```bash
npm run dev
```

Then open `http://localhost:5173` in your browser.

### Building Formula

If you make changes to the formula grammar, you need to rebuild the formula parser:

```bash
npm run build:formula
```
