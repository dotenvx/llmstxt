#!/usr/bin/env node

const { Command } = require('commander')
const program = new Command()

const packageJson = require('./../lib/helpers/packageJson')

// cli
program
  .name('llmstxt')
  .description(packageJson.description)
  .version(packageJson.version)

// llmstxt gen
const genAction = require('./actions/gen')
program.command('gen')
  .description('generate llms.txt')
  .argument('[url]', 'sitemap url', 'https://vercel.com/sitemap.xml')
  .option('-ep, --exclude-path <excludePath...>', 'path(s) to exclude from generation (default: none)')
  .option('-ip, --include-path <includePath...>', 'path(s) to include from generation (default: all)')
  .option('-rt, --replace-title <replaceTitle...>', 'replace string(s) from title (default: none)')
  .option('-t, --title <title>', 'set title (default: root page title)')
  .option('-d, --description <description>', 'set description (default: root page description)')
  .option('-c, --concurrency <concurrency>', 'maximum number of concurrent connections (default: 5)', parseInt)
  .action(genAction)

// Add gen-full command
program.command('gen-full')
  .description('generate llms-full.txt (full markdown content for each page)')
  .argument('[url]', 'sitemap url', 'https://vercel.com/sitemap.xml')
  .option('-ep, --exclude-path <excludePath...>', 'path(s) to exclude from generation (default: none)')
  .option('-ip, --include-path <includePath...>', 'path(s) to include from generation (default: all)')
  .option('-rt, --replace-title <replaceTitle...>', 'replace string(s) from title (default: none)')
  .option('-t, --title <title>', 'set title (default: root page title)')
  .option('-d, --description <description>', 'set description (default: root page description)')
  .option('-c, --concurrency <concurrency>', 'maximum number of concurrent connections (default: 5)', parseInt)
  .action(genAction.genFull)

program.parse()
