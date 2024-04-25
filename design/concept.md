---
title: Project Concept
target-version: 0.1.0
---

# Project Concept

## Overview

Wafflebase is a simple spreadsheet designed for large-scale data processing and analysis. It leverages [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API), a local database, to store data, reducing memory usage.

Despite being a local database, IndexedDB operates asynchronously, mirroring the usage of a remote database. To simplify its use, Wafflebase employs a grid cache that holds data in memory.

```
+-------------+    +-------+    +-----------+    +---------------+
|             |    |       |    |           |    |               |
| Spreadsheet |<-->| Cache |<-->| IndexedDB |<-->| Central Cloud |
|             |    |       |    |           |    |               |
+-------------+    +-------+    +-----------+    +---------------+
```

Here's how it works:

1. The spreadsheet asks the grid cache for the required data.
2. The grid cache verifies if the requested data is already in the cache.
3. If the data is cached, it is immediately returned to the spreadsheet.
4. If the data isn't cached, the grid cache requests the data from IndexedDB.
5. IndexedDB then sends the requested data back to the grid cache.
6. The grid cache forwards the received data to the spreadsheet and simultaneously stores it in the cache for future use.
7. IndexedDB periodically syncs with the central cloud database or does so when triggered by a specific event.

This process enables efficient data synchronization across multiple devices. The synchronization with the central cloud database happens asynchronously in the background, ensuring a seamless user experience.
