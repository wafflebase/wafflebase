# wafflebase

Wafflebase is a simple spreadsheet for large-scale data processing and analysis.

## Why Wafflebase?

Wafflebase is designed to be familiar to users of traditional spreadsheets, but with the ability to handle much larger datasets. Wafflebase is fully open-source and can be run on your own machine or server.

## Status of Wafflebase

Wafflebase is currently in the early stages of development. It is not yet ready for production use. If you are interested in contributing, please see the [Contributing](https://github.com/wafflebase/wafflebase#contributing) section below.

## Overview

Wafflebase is a web-based spreadsheet application designed as a lightweight alternative to Google Sheets and Microsoft Excel.

The system comprises four main components: Spreadsheet, Worksheet, Store, Formula.

```
┌─────────────────┐ ┌─────────────────┐ ┌────────────────┐
│  Spreadsheet    │ │  Worksheet      │ │     Store      │
│ ┌────────────┐  │ │ ┌─────────────┐ │ │  ┌──────────┐  │
│ │ Data       │  │ │ │ Data Model  │ │ │  │Save/Load │  │
│ │ Rendering  │  │ │ │             │ │ │  └──────────┘  │
│ └────────────┘  │ │ └─────────────┘ │ └────────────────┘
│                 │ │                 │ ┌────────────────┐
│ ┌────────────┐  │ │ ┌─────────────┐ │ │    Formula     │
│ │ User Input │  │ │ │ Cell        │ │ │ ┌────────────┐ │
│ │ Processing │  │ │ │ Calculation │ │ │ │ Evaluation │ │
│ └────────────┘  │ │ └─────────────┘ │ │ └────────────┘ │
└─────────────────┘ └─────────────────┘ └────────────────┘
```

- **Spreadsheet**: component handles the user interface. It manages worksheet operations, cell editing, formatting, and all user interactions. It works closely with the Worksheet component to display data and process user inputs.
- **Worksheet**: component manages the data model for individual worksheets. It stores cell values, tracks dependencies, and coordinates formula calculations. It collaborates with the Formula component to evaluate formulas and interacts with the Store component to save and load data.
- **Store**: component is responsible for persistent data storage. It interacts with local storage or server databases to save and retrieve worksheet data. Optionally, it can provide version control or multi-user support features.
- **Formula**: component acts as the formula processing engine. It parses and evaluates formulas, and manages the supported function library. It works with the Worksheet component to calculate formula-based cell values.

## Contributing

### Setting Development Environment

#### Prerequisites

You need to have the following software installed on your system:

- [Node.js](https://nodejs.org/en/) (version 18 or later)

#### Building & Testing

```bash
cd frontend
npm install
npm run build
npm test
```

#### Running

```bash
cd frontend
npm run dev
```

Then open `http://localhost:5173` in your browser.

#### Building Formula

If you make changes to the formula grammar, you need to rebuild the formula parser:

```bash
cd frontend
npm run build:formula
```
