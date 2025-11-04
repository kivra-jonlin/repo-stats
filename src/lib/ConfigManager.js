import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import chalk from 'chalk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, '../../config.json');

export class ConfigManager {
  constructor() {
    this.config = null;
  }

  async loadConfig() {
    try {
      const configData = await fs.readFile(CONFIG_FILE, 'utf8');
      this.config = JSON.parse(configData);
      return this.config;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Config file doesn't exist, create default
        this.config = {
          repositories: [],
          settings: {
            defaultDays: 30,
            updateInterval: 3600 // 1 hour in seconds
          }
        };
        await this.saveConfig();
        return this.config;
      }
      throw error;
    }
  }

  async saveConfig() {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(this.config, null, 2));
  }

  async addRepository(repoConfig) {
    if (!this.config) {
      await this.loadConfig();
    }

    this.config.repositories.push({
      id: `${repoConfig.platform}-${repoConfig.owner}-${repoConfig.name}`,
      ...repoConfig,
      addedAt: new Date().toISOString()
    });

    await this.saveConfig();
  }

  async getRepositories() {
    if (!this.config) {
      await this.loadConfig();
    }
    return this.config.repositories;
  }

  async interactiveSetup() {
    console.log(chalk.blue('📝 Interactive Repository Configuration\n'));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const question = (query) => new Promise((resolve) => rl.question(query, resolve));

    try {
      console.log('Let\'s add a new repository to track:\n');

      const platform = await question('Platform (github/gitlab/bitbucket): ');
      const owner = await question('Repository owner/organization: ');
      const name = await question('Repository name: ');
      const deploymentMethod = await question('Deployment detection method (tags/releases/workflow): ');
      const branch = await question('Main branch (optional, default: main): ') || 'main';

      const repoConfig = {
        platform: platform.toLowerCase(),
        owner,
        name,
        deploymentMethod: deploymentMethod.toLowerCase(),
        branch,
        url: this.buildRepoUrl(platform, owner, name)
      };

      await this.addRepository(repoConfig);

      console.log(chalk.green('\n✅ Repository added successfully!'));
      console.log(chalk.gray(`Added: ${repoConfig.url}`));

      const addAnother = await question('\nAdd another repository? (y/N): ');
      if (addAnother.toLowerCase() === 'y') {
        await this.interactiveSetup();
      }

    } finally {
      rl.close();
    }
  }

  buildRepoUrl(platform, owner, name) {
    const urls = {
      github: `https://github.com/${owner}/${name}`,
      gitlab: `https://gitlab.com/${owner}/${name}`,
      bitbucket: `https://bitbucket.org/${owner}/${name}`
    };
    return urls[platform.toLowerCase()] || `${platform}:${owner}/${name}`;
  }

  async listRepositories() {
    const repositories = await this.getRepositories();
    
    if (repositories.length === 0) {
      console.log(chalk.yellow('No repositories configured.'));
      console.log(chalk.gray('Run with --action=config to add repositories.'));
      return;
    }

    console.log(chalk.blue('📋 Configured Repositories:\n'));
    repositories.forEach((repo, index) => {
      console.log(`${index + 1}. ${chalk.cyan(repo.url)}`);
      console.log(`   Platform: ${repo.platform}`);
      console.log(`   Detection: ${repo.deploymentMethod}`);
      console.log(`   Branch: ${repo.branch}`);
      console.log('');
    });
  }
}
