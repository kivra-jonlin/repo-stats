import chalk from 'chalk';
import { table } from 'table';
import { GitHubProvider } from './providers/GitHubProvider.js';
import { GitLabProvider } from './providers/GitLabProvider.js';
import { LeadTimeCalculator } from './LeadTimeCalculator.js';

export class RepoStatsCounter {
  constructor(configManager, dbManager) {
    this.configManager = configManager;
    this.dbManager = dbManager;
    this.leadTimeCalculator = new LeadTimeCalculator(dbManager);
    this.providers = {
      github: new GitHubProvider(),
      gitlab: new GitLabProvider()
    };
  }

  async countDeployments(days = 30, specificRepo = null) {
    const repositories = await this.configManager.getRepositories();
    
    if (repositories.length === 0) {
      console.log(chalk.yellow('⚠️  No repositories configured.'));
      console.log(chalk.gray('Run with --action=config to add repositories.'));
      return;
    }

    const reposToProcess = specificRepo 
      ? repositories.filter(repo => repo.id.includes(specificRepo) || repo.name.includes(specificRepo))
      : repositories;

    if (reposToProcess.length === 0) {
      console.log(chalk.yellow(`⚠️  No repositories found matching: ${specificRepo}`));
      return;
    }

    for (const repo of reposToProcess) {
      console.log(chalk.blue(`📊 Processing: ${repo.owner}/${repo.name}`));
      
      try {
        const provider = this.providers[repo.platform];
        if (!provider) {
          console.log(chalk.red(`❌ Unsupported platform: ${repo.platform}`));
          continue;
        }

        const deployments = await provider.getDeployments(repo, days);
        console.log(chalk.green(`   Found ${deployments.length} deployments`));

        // Store deployments in database
        let insertedCount = 0;
        for (const deployment of deployments) {
          try {
            await this.dbManager.insertDeployment({
              repository_id: repo.id,
              deployment_id: deployment.id,
              deployment_type: deployment.type,
              deployment_date: deployment.date,
              commit_sha: deployment.commit_sha,
              tag_name: deployment.tag_name,
              branch: deployment.branch,
              status: deployment.status,
              environment: deployment.environment
            });
            insertedCount++;
          } catch (error) {
            // Deployment might already exist (UNIQUE constraint)
            if (!error.message.includes('UNIQUE constraint')) {
              console.log(chalk.yellow(`   Warning: Failed to insert deployment ${deployment.id}`));
            }
          }
        }

        await this.dbManager.updateRepositoryStats(repo.id, deployments.length);
        console.log(chalk.gray(`   Stored ${insertedCount} new deployments\n`));

      } catch (error) {
        console.log(chalk.red(`   Error processing ${repo.name}: ${error.message}\n`));
      }
    }
  }

  async displayStats(format = 'table', specificRepo = null) {
    const stats = await this.dbManager.getDeploymentStats(specificRepo);
    
    if (stats.length === 0) {
      console.log(chalk.yellow('📈 No deployment statistics available.'));
      console.log(chalk.gray('Run the counter first to collect deployment data.'));
      return;
    }

    switch (format) {
      case 'json':
        console.log(JSON.stringify(stats, null, 2));
        break;
      
      case 'csv':
        this.displayCSV(stats);
        break;
      
      case 'table':
      default:
        this.displayTable(stats);
        break;
    }
  }

  displayTable(stats) {
    console.log(chalk.blue('📈 Deployment Statistics\n'));

    const data = [
      ['Repository', 'Deployments', 'Active Days', 'Avg/Day', 'First Deploy', 'Last Deploy']
    ];

    stats.forEach(stat => {
      const avgPerDay = stat.active_days > 0 ? (stat.deployment_count / stat.active_days).toFixed(1) : '0';
      const firstDeploy = stat.first_deployment ? new Date(stat.first_deployment).toLocaleDateString() : 'N/A';
      const lastDeploy = stat.last_deployment ? new Date(stat.last_deployment).toLocaleDateString() : 'N/A';
      
      data.push([
        stat.repository_id.replace(/^[^-]+-[^-]+-/, ''), // Remove platform-owner prefix
        stat.deployment_count.toString(),
        stat.active_days.toString(),
        avgPerDay,
        firstDeploy,
        lastDeploy
      ]);
    });

    console.log(table(data, {
      border: {
        topBody: '─',
        topJoin: '┬',
        topLeft: '┌',
        topRight: '┐',
        bottomBody: '─',
        bottomJoin: '┴',
        bottomLeft: '└',
        bottomRight: '┘',
        bodyLeft: '│',
        bodyRight: '│',
        bodyJoin: '│',
        joinBody: '─',
        joinLeft: '├',
        joinRight: '┤',
        joinJoin: '┼'
      }
    }));

    // Summary
    const totalDeployments = stats.reduce((sum, stat) => sum + stat.deployment_count, 0);
    const totalRepos = stats.length;
    
    console.log(chalk.blue('📊 Summary:'));
    console.log(`   Total Repositories: ${chalk.cyan(totalRepos)}`);
    console.log(`   Total Deployments: ${chalk.cyan(totalDeployments)}`);
    console.log(`   Average per Repo: ${chalk.cyan((totalDeployments / totalRepos).toFixed(1))}\n`);
  }

  displayCSV(stats) {
    console.log('repository,deployments,active_days,avg_per_day,first_deployment,last_deployment');
    stats.forEach(stat => {
      const avgPerDay = stat.active_days > 0 ? (stat.deployment_count / stat.active_days).toFixed(1) : '0';
      console.log([
        stat.repository_id,
        stat.deployment_count,
        stat.active_days,
        avgPerDay,
        stat.first_deployment || '',
        stat.last_deployment || ''
      ].join(','));
    });
  }

  async collectPullRequestData(days = 30, specificRepo = null) {
    const repositories = await this.configManager.getRepositories();
    
    if (repositories.length === 0) {
      console.log(chalk.yellow('⚠️  No repositories configured.'));
      return;
    }

    const reposToProcess = specificRepo 
      ? repositories.filter(repo => repo.id.includes(specificRepo) || repo.name.includes(specificRepo))
      : repositories;

    if (reposToProcess.length === 0) {
      console.log(chalk.yellow(`⚠️  No repositories found matching: ${specificRepo}`));
      return;
    }

    for (const repo of reposToProcess) {
      console.log(chalk.blue(`📋 Collecting PRs from: ${repo.owner}/${repo.name}`));
      
      try {
        const provider = this.providers[repo.platform];
        if (!provider) {
          console.log(chalk.red(`❌ Unsupported platform: ${repo.platform}`));
          continue;
        }

        const pullRequests = await provider.getPullRequests(repo, days);
        console.log(chalk.green(`   Found ${pullRequests.length} merged PRs`));

        // Store PRs in database
        let insertedCount = 0;
        for (const pr of pullRequests) {
          try {
            await this.dbManager.insertPullRequest({
              repository_id: repo.id,
              ...pr
            });
            insertedCount++;
          } catch (error) {
            // PR might already exist (UNIQUE constraint)
            if (!error.message.includes('UNIQUE constraint')) {
              console.log(chalk.yellow(`   Warning: Failed to insert PR #${pr.pr_number}`));
            }
          }
        }

        console.log(chalk.gray(`   Stored ${insertedCount} new PRs\n`));

      } catch (error) {
        console.log(chalk.red(`   Error collecting PRs from ${repo.name}: ${error.message}\n`));
      }
    }
  }

  async calculateAndDisplayLeadTime(days = 30, specificRepo = null, format = 'table', showInsights = false) {
    const repositories = await this.configManager.getRepositories();
    const reposToProcess = specificRepo 
      ? repositories.filter(repo => repo.id.includes(specificRepo) || repo.name.includes(specificRepo))
      : repositories;

    for (const repo of reposToProcess) {
      await this.leadTimeCalculator.calculateLeadTime(repo.id, days);
    }

    await this.displayLeadTimeStats(days, specificRepo, format, showInsights);
  }

  async displayLeadTimeStats(days = 30, specificRepo = null, format = 'table', showInsights = false) {
    let repositoryFilter = null;
    
    if (specificRepo) {
      const repositories = await this.configManager.getRepositories();
      const matchedRepo = repositories.find(repo => 
        repo.id.includes(specificRepo) || repo.name.includes(specificRepo)
      );
      if (matchedRepo) {
        repositoryFilter = matchedRepo.id;
      }
    }

    const stats = await this.dbManager.getLeadTimeStats(repositoryFilter, days);
    
    if (stats.length === 0) {
      console.log(chalk.yellow('📈 No lead time statistics available.'));
      console.log(chalk.gray('Run with --action=pull-requests first to collect PR data.'));
      return;
    }

    switch (format) {
      case 'json':
        console.log(JSON.stringify(stats, null, 2));
        break;
      
      case 'csv':
        this.displayLeadTimeCSV(stats);
        break;
      
      case 'table':
      default:
        await this.displayLeadTimeTable(stats, days, showInsights);
        break;
    }
  }

  async displayLeadTimeTable(stats, days, showInsights = false) {
    console.log(chalk.blue('⏱️  Lead Time for Changes (DORA Metric)\n'));

    const data = [
      ['Repository', 'PRs', 'Avg Lead Time', 'P50', 'P75', 'P90', 'P95', '<1 Day', '<1 Week', 'Performance']
    ];

    for (const stat of stats) {
      const repoName = stat.repository_id.replace(/^[^-]+-[^-]+-/, '');
      const percentiles = await this.leadTimeCalculator.getLeadTimePercentiles(stat.repository_id, days);
      const category = this.leadTimeCalculator.categorizeLeadTime(stat.avg_lead_time_hours);
      
      const formatTime = (hours) => {
        if (!hours) return 'N/A';
        const days = Math.round(hours / 24 * 10) / 10;
        return days < 1 ? `${Math.round(hours)}h` : `${days}d`;
      };

      const under24hPercent = ((stat.under_24h_count / stat.pr_count) * 100).toFixed(0);
      const under1wPercent = ((stat.under_1week_count / stat.pr_count) * 100).toFixed(0);

      data.push([
        repoName,
        stat.pr_count.toString(),
        formatTime(stat.avg_lead_time_hours),
        formatTime(percentiles.p50),
        formatTime(percentiles.p75),
        formatTime(percentiles.p90),
        formatTime(percentiles.p95),
        `${under24hPercent}%`,
        `${under1wPercent}%`,
        category.category
      ]);
    }

    console.log(table(data, {
      border: {
        topBody: '─',
        topJoin: '┬',
        topLeft: '┌',
        topRight: '┐',
        bottomBody: '─',
        bottomJoin: '┴',
        bottomLeft: '└',
        bottomRight: '┘',
        bodyLeft: '│',
        bodyRight: '│',
        bodyJoin: '│',
        joinBody: '─',
        joinLeft: '├',
        joinRight: '┤',
        joinJoin: '┼'
      }
    }));

    // DORA Performance Categories
    console.log(chalk.blue('🎯 DORA Performance Categories:'));
    console.log(`   ${chalk.green('Elite')}: Less than 1 day`);
    console.log(`   ${chalk.blue('High')}: 1-7 days`);
    console.log(`   ${chalk.yellow('Medium')}: 1-4 weeks`);
    console.log(`   ${chalk.red('Low')}: More than 1 month\n`);

    // Show insights if requested
    if (showInsights && stats.length > 0) {
      console.log(chalk.blue('💡 Insights & Recommendations:\n'));
      
      for (const stat of stats) {
        const repoName = stat.repository_id.replace(/^[^-]+-[^-]+-/, '');
        const insights = await this.leadTimeCalculator.generateInsights(stat.repository_id, days);
        
        console.log(chalk.cyan(`${repoName}:`));
        console.log(`   Performance: ${chalk.bold(insights.category)}`);
        console.log(`   Average Lead Time: ${insights.avgLeadTimeDays?.toFixed(1)} days`);
        
        if (insights.recommendations.length > 0) {
          console.log('   Recommendations:');
          insights.recommendations.forEach(rec => {
            console.log(`     • ${rec}`);
          });
        }
        console.log('');
      }
    }
  }

  displayLeadTimeCSV(stats) {
    console.log('repository,pr_count,avg_lead_time_hours,avg_lead_time_days,min_lead_time_hours,max_lead_time_hours,avg_commit_to_merge_hours,avg_merge_to_deploy_hours,under_24h_percent,under_1week_percent');
    stats.forEach(stat => {
      const under24hPercent = ((stat.under_24h_count / stat.pr_count) * 100).toFixed(1);
      const under1wPercent = ((stat.under_1week_count / stat.pr_count) * 100).toFixed(1);
      
      console.log([
        stat.repository_id,
        stat.pr_count,
        stat.avg_lead_time_hours,
        stat.avg_lead_time_days,
        stat.min_lead_time_hours,
        stat.max_lead_time_hours,
        stat.avg_commit_to_merge_hours || 0,
        stat.avg_merge_to_deploy_hours || 0,
        under24hPercent,
        under1wPercent
      ].join(','));
    });
  }
}
