const { URL } = require('url')
const cheerio = require('cheerio')
const picomatch = require('picomatch')
const { request } = require('undici')
const Sitemapper = require('sitemapper')
const sitemap = new Sitemapper()
const ora = require('ora')
const TurndownService = require('turndown')

async function fetchHtml (url) {
  try {
    const { body } = await request(url, { maxRedirections: 10 })
    const rawHtml = await body.text()
    return rawHtml
  } catch (_error) {
    return null
  }
}

async function getTitle (html) {
  try {
    const $ = cheerio.load(html)
    return $('head > title').text().trim()
  } catch (_error) {
    return null
  }
}

async function getDescription (html) {
  try {
    const $ = cheerio.load(html)

    // Check for <meta name="description">
    let description = $('head > meta[name="description"]').attr('content')

    // Fallback to <meta property="og:description">
    if (!description) {
      description = $('head > meta[property="og:description"]').attr('content')
    }

    // Fallback to <meta name="twitter:description">
    if (!description) {
      description = $('head > meta[name="twitter:description"]').attr('content')
    }

    return description
  } catch (_error) {
    return null
  }
}

function parseSubstitutionCommand (command) {
  const match = command.match(/^s\/(.*?)\/(.*?)\/([gimsuy]*)$/) // Capture optional flags

  if (match) {
    const pattern = match[1] // The pattern to search for
    const replacement = match[2] // The replacement string
    const flags = match[3] || '' // Extract flags (e.g., 'g', 'i')
    return { pattern: new RegExp(pattern, flags), replacement }
  } else {
    throw new Error('Invalid substitution command format')
  }
}

function parseSection(uri) {
  try {
    const url = new URL(uri)
    const segments = url.pathname.split('/').filter(Boolean)
    return segments[0] || 'ROOT'
  } catch (_error) {
    return 'ROOT'
  }
}

function substituteTitle (title, command) {
  if (!command || command.length < 1 || !command.startsWith('s/')) {
    return title
  }

  const { pattern, replacement } = parseSubstitutionCommand(command)

  return title.replace(pattern, replacement)
}

function isRootUrl (uri) {
  try {
    const url = new URL(uri)
    return url.pathname === '/'
  } catch (_error) {
    return false
  }
}

function capitalizeString(str) {
  if (!str || typeof str !== 'string') {
    return ''
  }

  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}

function cleanTitle(title) {
  if (!title) return '';
  // Remove leading '|' and whitespace
  return title.replace(/^\|\s*/, '').trim();
}

/**
 * Process URLs in batches with limited concurrency
 * @param {Array} items - Array of items to process
 * @param {Function} processor - Async function to process each item
 * @param {number} concurrency - Maximum number of concurrent operations
 * @returns {Array} - Results array
 */
async function processInBatches(items, processor, concurrency = 10) {
  const results = [];
  const totalItems = items.length;
  let processedItems = 0;

  // Process items in batches
  for (let i = 0; i < totalItems; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchPromises = batch.map(async (item, index) => {
      const result = await processor(item, i + index);
      processedItems++;
      return result;
    });

    // Wait for the current batch to complete
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  return results.filter(Boolean); // Remove null/undefined results
}

async function gen (sitemapUrl) {
  const options = this.opts()

  const spinner = ora('generating').start()

  // include/exclude logic
  const excludePaths = options.excludePath || []
  const includePaths = options.includePath || []
  const isExcluded = picomatch(excludePaths)
  const isIncluded = picomatch(includePaths, { ignore: excludePaths })

  // replaceTitle logic
  const replaceTitle = options.replaceTitle || []

  const sections = {}
  const concurrency = options.concurrency || 5

  try {
    spinner.text = sitemapUrl
    const sites = await sitemap.fetch(sitemapUrl)
    
    // Define the URL processor function
    const processUrl = async (url, index) => {
      spinner.text = `Processing [${index + 1}/${sites.sites.length}]: ${url}`

      // path excluded - don't process it
      if (isExcluded(url)) {
        return null;
      }

      // path effectively excluded (by not being in the list of includes) - don't process it
      if (includePaths.length > 0 && !isIncluded(url)) {
        return null;
      }

      // html
      const html = await fetchHtml(url)
      if (!html) {
        return null;
      }

      // title
      let title = await getTitle(html)
      if (!title) {
        return null;
      }
      for (command of replaceTitle) {
        title = substituteTitle(title, command)
      }
      title = cleanTitle(title)

      // description
      const description = await getDescription(html)

      // section
      const section = parseSection(url)
      
      return { title, url, description, section };
    };

    // Process URLs concurrently
    const results = await processInBatches(sites.sites, processUrl, concurrency);
    
    // Organize results into sections
    for (const result of results) {
      if (!result) continue;
      
      const { title, url, description, section } = result;
      
      // set up section
      sections[section] ||= []

      // add line
      sections[section].push({ title, url, description });
    }
  } catch (error) {
    console.error('Error processing sitemap:', error.message)
  }

  let output = ''

  // handle root
  const root = sections.ROOT || []
  delete sections.ROOT

  // Default values if root doesn't exist
  const defaultTitle = options.title || 'Documentation'
  const defaultDescription = options.description || 'Generated documentation'

  output += `# ${options.title || (root.length > 0 ? root[0].title : defaultTitle)}`
  output += '\n'
  output += '\n'
  output += `> ${options.description || (root.length > 0 ? root[0].description : defaultDescription)}`
  output += '\n'
  output += '\n'

  spinner.text = options.title || (root.length > 0 ? root[0].title : defaultTitle)

  // handle sections
  for (const section in sections) {
    output += `## ${capitalizeString(section)}`
    output += '\n'
    for (const line of sections[section]) {
      const { title, url, description } = line
      output += '\n'
      output += `- [${title}](${url})${description ? ': ' + description : ''}`

      spinner.text = title
    }
    output += '\n'
    output += '\n'
  }
  spinner.succeed('generated')

  console.log(output)
}

async function genFull(sitemapUrl) {
  const options = this.opts ? this.opts() : {};
  const spinner = ora('generating full content').start();
  const excludePaths = options.excludePath || [];
  const includePaths = options.includePath || [];
  const isExcluded = picomatch(excludePaths);
  const isIncluded = picomatch(includePaths, { ignore: excludePaths });
  const replaceTitle = options.replaceTitle || [];
  const concurrency = options.concurrency || 5;
  // Configure Turndown for better markdown
  const turndownService = new TurndownService({
    codeBlockStyle: 'fenced',
    headingStyle: 'atx',
    bulletListMarker: '-',
    emDelimiter: '*',
    hr: '---',
  });
  turndownService.addRule('table', {
    filter: 'table',
    replacement: function(content, node) {
      return '\n' + turndownService.turndown(node.outerHTML) + '\n';
    }
  });
  let output = '';
  let toc = '';
  let skipped = [];
  let pageSections = [];

  try {
    spinner.text = sitemapUrl;
    const sites = await sitemap.fetch(sitemapUrl);
    // Try to get lastmod from sitemap if available
    const urlToLastMod = {};
    if (sites.urls && Array.isArray(sites.urls)) {
      for (const entry of sites.urls) {
        if (entry.loc && entry.lastmod) urlToLastMod[entry.loc] = entry.lastmod;
      }
    }
    const pageInfos = [];
    const processUrl = async (url, index) => {
      spinner.text = `Processing [${index + 1}/${sites.sites.length}]: ${url}`;
      if (isExcluded(url)) { skipped.push({url, reason: 'excluded'}); return null; }
      if (includePaths.length > 0 && !isIncluded(url)) { skipped.push({url, reason: 'not included'}); return null; }
      const html = await fetchHtml(url);
      if (!html) { skipped.push({url, reason: 'fetch failed'}); return null; }
      let title = await getTitle(html);
      if (!title) { skipped.push({url, reason: 'no title'}); return null; }
      for (const command of replaceTitle) {
        title = substituteTitle(title, command);
      }
      title = cleanTitle(title);
      let $ = cheerio.load(html);
      let mainHtml =
        $('main').html() ||
        $('[role=main]').html() ||
        $('.content, #content, .post, .docs, .article').first().html() ||
        $('article').html() ||
        $('body').html() ||
        html;
      let markdown = turndownService.turndown(mainHtml);
      // Try to extract H2/H3 sections for TOC anchors
      const anchor = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      pageInfos.push({ title, url, description: await getDescription(html), markdown, anchor, lastmod: urlToLastMod[url] });
      return true;
    };
    await processInBatches(sites.sites, processUrl, concurrency);
    // Build TOC
    toc += '# Table of Contents\n';
    for (const page of pageInfos) {
      toc += `- [${page.title}](#${page.anchor})\n`;
    }
    // Build output
    output += `# ${options.title || 'Full Documentation'}\n\n`;
    output += toc + '\n';
    for (const page of pageInfos) {
      output += `\n\n---\n\n`;
      output += `## ${page.title}\n\n`;
      output += `[${page.url}](${page.url})\n\n`;
      if (page.description) output += `> ${page.description}\n\n`;
      if (page.lastmod) output += `*Last modified: ${page.lastmod}*\n\n`;
      output += page.markdown + '\n';
    }
    if (skipped.length > 0) {
      output += '\n\n---\n\n## Skipped Pages\n';
      for (const s of skipped) {
        output += `- ${s.url} (${s.reason})\n`;
      }
    }
    spinner.succeed('full content generated');
    console.log(output);
  } catch (error) {
    spinner.fail('Error processing sitemap: ' + error.message);
  }
}

module.exports = Object.assign(gen, { genFull });
