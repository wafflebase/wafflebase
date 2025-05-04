# Wafflebase Sheet

## Overview

Wafflebase Sheet comprises four main components: Spreadsheet, Worksheet, Store, Formula.

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

#### Building Formula

If you make changes to the formula grammar, you need to rebuild the formula parser:

```bash
cd frontend
npm run build:formula
```
