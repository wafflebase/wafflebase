# wafflebase

Wafflebase is a simple spreadsheet for large-scale data processing and analysis.

## Why Wafflebase?

Wafflebase is designed to be familiar to users of traditional spreadsheets, but with the ability to handle much larger datasets. It provides a similar interface to Excel or Google Sheets but allows users to work with datasets that are too large to fit in memory. Wafflebase is fully open-source and can be run on your own machine or server.

## Status of Wafflebase

Wafflebase is currently in the early stages of development. It is not yet ready for production use. If you are interested in contributing, please see the [Contributing](https://github.com/wafflebase/wafflebase#contributing) section below.

## Contributing

### Setting Development Environment

#### Prerequisites

You need to have the following software installed on your system:

- [Node.js](https://nodejs.org/en/) (version 18 or later)

#### Building & Testing

```bash
npm install
npm run build
npm test
```

#### Running

```bash
npm run dev
```

Then open `http://localhost:5173` in your browser.

#### Building Formula

If you make changes to the formula grammar, you need to rebuild the formula parser:

```bash
npm run build:formula
```
