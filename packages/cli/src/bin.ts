#!/usr/bin/env node
import { runCli } from './cli.js';

// Wiring only. Everything testable — program construction and the
// last-resort error envelope — lives in `./cli.js`.
void runCli();
