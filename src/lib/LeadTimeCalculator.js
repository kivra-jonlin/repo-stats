import chalk from 'chalk';

export class LeadTimeCalculator {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  /**
   * Calculate lead time metrics for a repository
   * Lead Time = Time from first commit to production deployment
   */
  async calculateLeadTime(repositoryId, days = 30) {
    console.log(chalk.blue(`📊 Calculating lead time for repository: ${repositoryId}`));

    // Get all merged PRs for the time period
    const pullRequests = await this.dbManager.getPullRequestsForLeadTime(repositoryId, days);
    
    if (pullRequests.length === 0) {
      console.log(chalk.yellow('   No merged pull requests found for lead time calculation'));
      return [];
    }

    console.log(chalk.gray(`   Found ${pullRequests.length} merged PRs to analyze`));

    const leadTimeMetrics = [];

    for (const pr of pullRequests) {
      try {
        const metric = await this.calculatePRLeadTime(repositoryId, pr);
        if (metric) {
          await this.dbManager.insertLeadTimeMetric(metric);
          leadTimeMetrics.push(metric);
        }
      } catch (error) {
        console.warn(chalk.yellow(`   Warning: Could not calculate lead time for PR #${pr.pr_number}: ${error.message}`));
      }
    }

    console.log(chalk.green(`   Calculated lead time for ${leadTimeMetrics.length} PRs\n`));
    return leadTimeMetrics;
  }

  /**
   * Calculate lead time for a specific PR
   */
  async calculatePRLeadTime(repositoryId, pr) {
    if (!pr.first_commit_at || !pr.merged_at) {
      return null;
    }

    const firstCommitTime = new Date(pr.first_commit_at);
    const mergedTime = new Date(pr.merged_at);
    
    // Find the deployment that includes this PR's merge commit
    const deployment = await this.findDeploymentForPR(repositoryId, pr);
    
    let deployedTime = null;
    let mergeToDeployHours = null;
    let totalLeadTimeHours = null;

    if (deployment) {
      deployedTime = new Date(deployment.deployment_date);
      mergeToDeployHours = this.calculateHoursDifference(mergedTime, deployedTime);
      totalLeadTimeHours = this.calculateHoursDifference(firstCommitTime, deployedTime);
    } else {
      // If no deployment found, use merge time as deployment time
      // This represents commit-to-merge lead time
      deployedTime = mergedTime;
      mergeToDeployHours = 0;
      totalLeadTimeHours = this.calculateHoursDifference(firstCommitTime, mergedTime);
    }

    const commitToMergeHours = this.calculateHoursDifference(firstCommitTime, mergedTime);
    
    // Estimate coding vs review time based on PR creation and merge times
    const prCreatedTime = new Date(pr.created_at_pr);
    const codingTimeHours = this.calculateHoursDifference(firstCommitTime, prCreatedTime);
    const reviewTimeHours = this.calculateHoursDifference(prCreatedTime, mergedTime);

    return {
      repository_id: repositoryId,
      pr_id: pr.id,
      deployment_id: deployment?.id || null,
      coding_time_hours: Math.max(0, codingTimeHours),
      review_time_hours: Math.max(0, reviewTimeHours),
      deployment_time_hours: mergeToDeployHours,
      total_lead_time_hours: totalLeadTimeHours,
      commit_to_merge_hours: commitToMergeHours,
      merge_to_deploy_hours: mergeToDeployHours,
      first_commit_at: pr.first_commit_at,
      merged_at: pr.merged_at,
      deployed_at: deployedTime?.toISOString() || null
    };
  }

  /**
   * Find the deployment that contains this PR
   */
  async findDeploymentForPR(repositoryId, pr) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM deployments 
        WHERE repository_id = ? 
          AND deployment_date >= ? 
          AND (commit_sha = ? OR commit_sha = ?)
        ORDER BY deployment_date ASC 
        LIMIT 1
      `;

      this.dbManager.db.get(sql, [
        repositoryId,
        pr.merged_at,
        pr.head_sha,
        pr.merge_sha
      ], (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          resolve(row);
        } else {
          // Fallback: find the next deployment after merge
          const fallbackSql = `
            SELECT * FROM deployments 
            WHERE repository_id = ? 
              AND deployment_date >= ?
            ORDER BY deployment_date ASC 
            LIMIT 1
          `;

          this.dbManager.db.get(fallbackSql, [repositoryId, pr.merged_at], (err, fallbackRow) => {
            if (err) reject(err);
            else resolve(fallbackRow || null);
          });
        }
      });
    });
  }

  /**
   * Calculate the difference in hours between two dates
   */
  calculateHoursDifference(startDate, endDate) {
    const diffMs = endDate.getTime() - startDate.getTime();
    return diffMs / (1000 * 60 * 60); // Convert to hours
  }

  /**
   * Get lead time percentiles (50th, 75th, 90th, 95th)
   */
  async getLeadTimePercentiles(repositoryId, days = 30) {
    const percentileData = await this.dbManager.getLeadTimePercentiles(repositoryId, days);
    
    const percentiles = {
      p50: null,
      p75: null,
      p90: null,
      p95: null
    };

    if (percentileData.length === 0) return percentiles;

    // Calculate percentiles
    const findPercentile = (target) => {
      const item = percentileData.find(d => d.percentile >= target);
      return item ? item.total_lead_time_hours : null;
    };

    percentiles.p50 = findPercentile(50);
    percentiles.p75 = findPercentile(75);
    percentiles.p90 = findPercentile(90);
    percentiles.p95 = findPercentile(95);

    return percentiles;
  }

  /**
   * Categorize lead time performance
   */
  categorizeLeadTime(hours) {
    const days = hours / 24;
    
    if (days <= 1) return { category: 'Elite', color: 'green', description: 'Less than 1 day' };
    if (days <= 7) return { category: 'High', color: 'blue', description: '1-7 days' };
    if (days <= 30) return { category: 'Medium', color: 'yellow', description: '1-4 weeks' };
    return { category: 'Low', color: 'red', description: 'More than 1 month' };
  }

  /**
   * Generate lead time insights and recommendations
   */
  async generateInsights(repositoryId, days = 30) {
    const stats = await this.dbManager.getLeadTimeStats(repositoryId, days);
    const percentiles = await this.getLeadTimePercentiles(repositoryId, days);

    if (stats.length === 0) {
      return {
        message: 'No lead time data available',
        recommendations: ['Set up deployment tracking', 'Ensure PRs are properly linked to deployments']
      };
    }

    const repoStats = stats[0];
    const avgDays = repoStats.avg_lead_time_days;
    const category = this.categorizeLeadTime(repoStats.avg_lead_time_hours);

    const insights = {
      category: category.category,
      avgLeadTimeDays: avgDays,
      percentiles,
      recommendations: []
    };

    // Generate recommendations based on performance
    if (category.category === 'Low') {
      insights.recommendations.push(
        'Consider implementing feature flags to reduce batch sizes',
        'Review deployment pipeline for automation opportunities',
        'Implement more frequent deployments to reduce lead time'
      );
    } else if (category.category === 'Medium') {
      insights.recommendations.push(
        'Focus on reducing review time through better PR practices',
        'Automate more of the deployment process',
        'Consider trunk-based development'
      );
    } else {
      insights.recommendations.push(
        'Great lead time performance! Consider sharing practices with other teams',
        'Monitor for any increases in lead time as the team scales'
      );
    }

    return insights;
  }
}
