import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'stats.db');

export class DatabaseManager {
  constructor() {
    this.db = null;
  }

  async initialize() {
    // Ensure data directory exists
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
          reject(err);
          return;
        }
        this.createTables().then(resolve).catch(reject);
      });
    });
  }

  async createTables() {
    const createDeploymentsTable = `
      CREATE TABLE IF NOT EXISTS deployments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repository_id TEXT NOT NULL,
        deployment_id TEXT,
        deployment_type TEXT NOT NULL,
        deployment_date DATETIME NOT NULL,
        commit_sha TEXT,
        tag_name TEXT,
        branch TEXT,
        status TEXT DEFAULT 'unknown',
        environment TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(repository_id, deployment_id)
      )
    `;

    const createRepositoriesTable = `
      CREATE TABLE IF NOT EXISTS repositories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner TEXT NOT NULL,
        platform TEXT NOT NULL,
        url TEXT NOT NULL,
        last_checked DATETIME,
        total_deployments INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createStatsTable = `
      CREATE TABLE IF NOT EXISTS stats_summary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repository_id TEXT NOT NULL,
        date DATE NOT NULL,
        deployment_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(repository_id, date),
        FOREIGN KEY(repository_id) REFERENCES repositories(id)
      )
    `;

    const createPullRequestsTable = `
      CREATE TABLE IF NOT EXISTS pull_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repository_id TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        pr_id TEXT NOT NULL,
        title TEXT,
        author TEXT,
        created_at_pr DATETIME NOT NULL,
        merged_at DATETIME,
        closed_at DATETIME,
        first_commit_at DATETIME,
        last_commit_at DATETIME,
        base_branch TEXT,
        head_branch TEXT,
        head_sha TEXT,
        merge_sha TEXT,
        state TEXT,
        is_merged BOOLEAN DEFAULT 0,
        lines_added INTEGER DEFAULT 0,
        lines_deleted INTEGER DEFAULT 0,
        commits_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(repository_id, pr_number),
        FOREIGN KEY(repository_id) REFERENCES repositories(id)
      )
    `;

    const createLeadTimeMetricsTable = `
      CREATE TABLE IF NOT EXISTS lead_time_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repository_id TEXT NOT NULL,
        pr_id INTEGER NOT NULL,
        deployment_id INTEGER,
        coding_time_hours REAL,
        review_time_hours REAL,
        deployment_time_hours REAL,
        total_lead_time_hours REAL NOT NULL,
        commit_to_merge_hours REAL,
        merge_to_deploy_hours REAL,
        first_commit_at DATETIME NOT NULL,
        merged_at DATETIME,
        deployed_at DATETIME,
        calculated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(repository_id) REFERENCES repositories(id),
        FOREIGN KEY(pr_id) REFERENCES pull_requests(id),
        FOREIGN KEY(deployment_id) REFERENCES deployments(id)
      )
    `;

    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run(createRepositoriesTable);
        this.db.run(createDeploymentsTable);
        this.db.run(createStatsTable);
        this.db.run(createPullRequestsTable);
        this.db.run(createLeadTimeMetricsTable, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }

  async insertDeployment(deployment) {
    const sql = `
      INSERT OR REPLACE INTO deployments 
      (repository_id, deployment_id, deployment_type, deployment_date, commit_sha, tag_name, branch, status, environment)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    return new Promise((resolve, reject) => {
      this.db.run(sql, [
        deployment.repository_id,
        deployment.deployment_id,
        deployment.deployment_type,
        deployment.deployment_date,
        deployment.commit_sha,
        deployment.tag_name,
        deployment.branch,
        deployment.status,
        deployment.environment
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  async updateRepositoryStats(repositoryId, totalDeployments) {
    const sql = `
      INSERT OR REPLACE INTO repositories 
      (id, name, owner, platform, url, last_checked, total_deployments, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)
    `;

    // This is a simplified version - in practice you'd want to get repo details from config
    return new Promise((resolve, reject) => {
      this.db.run(sql, [
        repositoryId,
        repositoryId.split('-')[2] || 'unknown',
        repositoryId.split('-')[1] || 'unknown', 
        repositoryId.split('-')[0] || 'unknown',
        '',
        totalDeployments
      ], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async getDeploymentStats(repositoryId = null, days = 30) {
    const dateFilter = `datetime('now', '-${days} days')`;
    
    let sql = `
      SELECT 
        d.repository_id,
        COUNT(*) as deployment_count,
        MIN(d.deployment_date) as first_deployment,
        MAX(d.deployment_date) as last_deployment,
        COUNT(DISTINCT DATE(d.deployment_date)) as active_days
      FROM deployments d
      WHERE d.deployment_date >= ${dateFilter}
    `;

    if (repositoryId) {
      sql += ` AND d.repository_id = ?`;
    }

    sql += ` GROUP BY d.repository_id ORDER BY deployment_count DESC`;

    return new Promise((resolve, reject) => {
      const params = repositoryId ? [repositoryId] : [];
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async getDeploymentHistory(repositoryId, days = 30) {
    const sql = `
      SELECT 
        DATE(deployment_date) as date,
        COUNT(*) as count,
        deployment_type,
        GROUP_CONCAT(tag_name) as tags
      FROM deployments 
      WHERE repository_id = ? 
        AND deployment_date >= datetime('now', '-${days} days')
      GROUP BY DATE(deployment_date), deployment_type
      ORDER BY date DESC
    `;

    return new Promise((resolve, reject) => {
      this.db.all(sql, [repositoryId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async insertPullRequest(pr) {
    const sql = `
      INSERT OR REPLACE INTO pull_requests 
      (repository_id, pr_number, pr_id, title, author, created_at_pr, merged_at, closed_at, 
       first_commit_at, last_commit_at, base_branch, head_branch, head_sha, merge_sha, 
       state, is_merged, lines_added, lines_deleted, commits_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;

    return new Promise((resolve, reject) => {
      this.db.run(sql, [
        pr.repository_id,
        pr.pr_number,
        pr.pr_id,
        pr.title,
        pr.author,
        pr.created_at_pr,
        pr.merged_at,
        pr.closed_at,
        pr.first_commit_at,
        pr.last_commit_at,
        pr.base_branch,
        pr.head_branch,
        pr.head_sha,
        pr.merge_sha,
        pr.state,
        pr.is_merged ? 1 : 0,
        pr.lines_added || 0,
        pr.lines_deleted || 0,
        pr.commits_count || 0
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  async insertLeadTimeMetric(metric) {
    const sql = `
      INSERT OR REPLACE INTO lead_time_metrics 
      (repository_id, pr_id, deployment_id, coding_time_hours, review_time_hours, 
       deployment_time_hours, total_lead_time_hours, commit_to_merge_hours, 
       merge_to_deploy_hours, first_commit_at, merged_at, deployed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    return new Promise((resolve, reject) => {
      this.db.run(sql, [
        metric.repository_id,
        metric.pr_id,
        metric.deployment_id,
        metric.coding_time_hours,
        metric.review_time_hours,
        metric.deployment_time_hours,
        metric.total_lead_time_hours,
        metric.commit_to_merge_hours,
        metric.merge_to_deploy_hours,
        metric.first_commit_at,
        metric.merged_at,
        metric.deployed_at
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  async getLeadTimeStats(repositoryId = null, days = 30) {
    const dateFilter = `datetime('now', '-${days} days')`;
    
    let sql = `
      SELECT 
        ltm.repository_id,
        COUNT(*) as pr_count,
        ROUND(AVG(ltm.total_lead_time_hours), 2) as avg_lead_time_hours,
        ROUND(AVG(ltm.total_lead_time_hours) / 24, 2) as avg_lead_time_days,
        MIN(ltm.total_lead_time_hours) as min_lead_time_hours,
        MAX(ltm.total_lead_time_hours) as max_lead_time_hours,
        ROUND(AVG(ltm.commit_to_merge_hours), 2) as avg_commit_to_merge_hours,
        ROUND(AVG(ltm.merge_to_deploy_hours), 2) as avg_merge_to_deploy_hours,
        COUNT(CASE WHEN ltm.total_lead_time_hours <= 24 THEN 1 END) as under_24h_count,
        COUNT(CASE WHEN ltm.total_lead_time_hours <= 168 THEN 1 END) as under_1week_count
      FROM lead_time_metrics ltm
      WHERE ltm.first_commit_at >= ${dateFilter}
    `;

    if (repositoryId) {
      sql += ` AND ltm.repository_id = ?`;
    }

    sql += ` GROUP BY ltm.repository_id ORDER BY avg_lead_time_hours ASC`;

    return new Promise((resolve, reject) => {
      const params = repositoryId ? [repositoryId] : [];
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async getLeadTimePercentiles(repositoryId = null, days = 30) {
    const dateFilter = `datetime('now', '-${days} days')`;
    
    let sql = `
      SELECT 
        repository_id,
        total_lead_time_hours,
        ROW_NUMBER() OVER (PARTITION BY repository_id ORDER BY total_lead_time_hours) * 100.0 / 
        COUNT(*) OVER (PARTITION BY repository_id) as percentile
      FROM lead_time_metrics
      WHERE first_commit_at >= ${dateFilter}
    `;

    if (repositoryId) {
      sql += ` AND repository_id = ?`;
    }

    sql += ` ORDER BY repository_id, total_lead_time_hours`;

    return new Promise((resolve, reject) => {
      const params = repositoryId ? [repositoryId] : [];
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async getPullRequestsForLeadTime(repositoryId, days = 30) {
    const sql = `
      SELECT pr.*, ltm.total_lead_time_hours, ltm.deployed_at
      FROM pull_requests pr
      LEFT JOIN lead_time_metrics ltm ON pr.id = ltm.pr_id
      WHERE pr.repository_id = ?
        AND pr.is_merged = 1
        AND pr.merged_at >= datetime('now', '-${days} days')
      ORDER BY pr.merged_at DESC
    `;

    return new Promise((resolve, reject) => {
      this.db.all(sql, [repositoryId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async close() {
    if (this.db) {
      return new Promise((resolve) => {
        this.db.close(resolve);
      });
    }
  }
}
