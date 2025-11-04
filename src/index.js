import { program } from 'commander';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { RepoStatsCounter } from './lib/RepoStatsCounter.js';
import { ConfigManager } from './lib/ConfigManager.js';
import { DatabaseManager } from './lib/DatabaseManager.js';
import { LeadTimeCalculator } from './lib/LeadTimeCalculator.js';

// Load environment variables
dotenv.config();

program
  .name('repo-stats-counter')
  .description('Count deployments from multiple git repositories')
  .version('1.0.0');

program
  .option('-a, --action <action>', 'Action to perform: count, stats, config, leadtime, pull-requests', 'count')
  .option('-d, --days <days>', 'Number of days to look back', '30')
  .option('-r, --repo <repo>', 'Specific repository to analyze')
  .option('-f, --format <format>', 'Output format: table, json, csv', 'table')
  .option('--setup', 'Initial setup and configuration')
  .option('--calculate-lead-time', 'Calculate lead time metrics')
  .option('--insights', 'Show lead time insights and recommendations');

program.parse();

const options = program.opts();

async function main() {
  try {
    console.log(chalk.blue('🚀 Repository Stats Counter\n'));

    const configManager = new ConfigManager();
    const dbManager = new DatabaseManager();
    const statsCounter = new RepoStatsCounter(configManager, dbManager);
    const leadTimeCalculator = new LeadTimeCalculator(dbManager);

    // Initialize database
    await dbManager.initialize();

    switch (options.action) {
      case 'config':
        await configManager.interactiveSetup();
        break;

      case 'stats':
        await statsCounter.displayStats(options.format, options.repo);
        break;

      case 'leadtime':
        if (options.calculateLeadTime || !options.repo) {
          console.log(chalk.yellow(`Collecting PR data and calculating lead time for the last ${options.days} days...\n`));
          await statsCounter.collectPullRequestData(parseInt(options.days), options.repo);
          await statsCounter.calculateAndDisplayLeadTime(parseInt(options.days), options.repo, options.format, options.insights);
        } else {
          await statsCounter.displayLeadTimeStats(parseInt(options.days), options.repo, options.format, options.insights);
        }
        break;

      case 'pull-requests':
        console.log(chalk.yellow(`Collecting pull request data for the last ${options.days} days...\n`));
        await statsCounter.collectPullRequestData(parseInt(options.days), options.repo);
        console.log(chalk.green('✅ Pull request data collected successfully!'));
        break;

      case 'count':
      default:
        console.log(chalk.yellow(`Counting deployments for the last ${options.days} days...\n`));
        await statsCounter.countDeployments(parseInt(options.days), options.repo);
        await statsCounter.displayStats(options.format, options.repo);
        break;
    }

  } catch (error) {
    console.error(chalk.red('❌ Error:'), error.message);
    if (process.env.LOG_LEVEL === 'debug') {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n👋 Goodbye!'));
  process.exit(0);
});

main();
