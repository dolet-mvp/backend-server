/**
 * Performance Monitoring Middleware
 * 
 * Purpose: Track request/response times and identify slow endpoints
 * 
 * Features:
 * - Adds X-Response-Time header to all responses
 * - Logs slow requests (>1000ms) with details
 * - Tracks endpoint performance statistics
 * - Helps identify bottlenecks in production
 * 
 * Usage:
 * const performanceMonitor = require('./middleware/performanceMonitor');
 * app.use(performanceMonitor);
 */

const redis = require('../config/redis/redis');

// Performance thresholds (milliseconds)
const SLOW_REQUEST_THRESHOLD = 1000; // Log requests > 1 second
const VERY_SLOW_REQUEST_THRESHOLD = 3000; // Alert for requests > 3 seconds
const CRITICAL_REQUEST_THRESHOLD = 5000; // Critical alert for requests > 5 seconds

/**
 * Main performance monitoring middleware
 */
const performanceMonitor = (req, res, next) => {
  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;
  
  // Track request details
  const requestInfo = {
    method: req.method,
    path: req.path,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  };
  
  // Capture response finish event
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const memoryUsed = process.memoryUsage().heapUsed - startMemory;
    const memoryUsedMB = (memoryUsed / 1024 / 1024).toFixed(2);
    
    // Log performance data
    const perfData = {
      ...requestInfo,
      statusCode: res.statusCode,
      duration,
      memoryUsedMB,
      timestamp: new Date().toISOString(),
    };
    
    // Log based on severity
    if (duration >= CRITICAL_REQUEST_THRESHOLD) {
      console.error('🔴 CRITICAL SLOW REQUEST:', {
        ...perfData,
        severity: 'CRITICAL',
        message: `Request took ${duration}ms (>${CRITICAL_REQUEST_THRESHOLD}ms threshold)`,
      });
      
      // Store critical requests in Redis for analysis
      storeCriticalRequest(perfData).catch(err => 
        console.error('Failed to store critical request:', err)
      );
    } else if (duration >= VERY_SLOW_REQUEST_THRESHOLD) {
      console.warn('🟠 VERY SLOW REQUEST:', {
        ...perfData,
        severity: 'HIGH',
        message: `Request took ${duration}ms (>${VERY_SLOW_REQUEST_THRESHOLD}ms threshold)`,
      });
    } else if (duration >= SLOW_REQUEST_THRESHOLD) {
      console.warn('⚠️ SLOW REQUEST:', {
        ...perfData,
        severity: 'MEDIUM',
        message: `Request took ${duration}ms (>${SLOW_REQUEST_THRESHOLD}ms threshold)`,
      });
    } else {
      // Log successful fast requests (debug level)
      console.log(`✅ ${req.method} ${req.path} - ${duration}ms - ${res.statusCode}`);
    }
    
    // Track endpoint statistics
    trackEndpointStats(req.path, duration).catch(err => 
      console.error('Failed to track endpoint stats:', err)
    );
  });
  
  next();
};

/**
 * Store critical slow requests in Redis for analysis
 */
async function storeCriticalRequest(perfData) {
  try {
    const key = `perf:critical:${Date.now()}`;
    await redis.setex(key, 86400, JSON.stringify(perfData)); // Keep for 24 hours
    
    // Also add to sorted set for easy retrieval
    await redis.zadd('perf:critical:index', {
      score: perfData.duration,
      member: key
    });
    
    // Keep only last 100 critical requests
    await redis.zremrangebyrank('perf:critical:index', 0, -101);
  } catch (error) {
    console.error('Error storing critical request:', error);
  }
}

/**
 * Track endpoint statistics (average response time, request count)
 */
async function trackEndpointStats(endpoint, duration) {
  try {
    const statsKey = `perf:stats:${endpoint}`;
    const stats = await redis.get(statsKey);
    
    let endpointStats;
    if (stats && typeof stats === 'string') {
      try {
        endpointStats = JSON.parse(stats);
      } catch (parseError) {
        console.warn(`⚠️ Invalid JSON in stats for ${endpoint}, resetting...`);
        await redis.del(statsKey);
        endpointStats = {
          endpoint,
          count: 0,
          totalDuration: 0,
          minDuration: Infinity,
          maxDuration: 0,
          avgDuration: 0,
        };
      }
    } else {
      endpointStats = {
        endpoint,
        count: 0,
        totalDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        avgDuration: 0,
      };
    }
    
    // Update statistics
    endpointStats.count += 1;
    endpointStats.totalDuration += duration;
    endpointStats.minDuration = Math.min(endpointStats.minDuration, duration);
    endpointStats.maxDuration = Math.max(endpointStats.maxDuration, duration);
    endpointStats.avgDuration = Math.round(endpointStats.totalDuration / endpointStats.count);
    endpointStats.lastUpdated = new Date().toISOString();
    
    // Store for 1 hour
    await redis.setex(statsKey, 3600, JSON.stringify(endpointStats));
  } catch (error) {
    console.error('Error tracking endpoint stats:', error);
  }
}

/**
 * Get performance statistics for an endpoint
 */
async function getEndpointStats(endpoint) {
  try {
    const statsKey = `perf:stats:${endpoint}`;
    const stats = await redis.get(statsKey);
    return stats ? JSON.parse(stats) : null;
  } catch (error) {
    console.error('Error getting endpoint stats:', error);
    return null;
  }
}

/**
 * Get all critical slow requests
 */
async function getCriticalRequests(limit = 20) {
  try {
    // Get keys sorted by duration (slowest first)
    const keys = await redis.zrange('perf:critical:index', 0, limit - 1, { rev: true });
    
    if (!keys || keys.length === 0) {
      return [];
    }
    
    // Fetch request details
    const requests = await Promise.all(
      keys.map(async (key) => {
        const data = await redis.get(key);
        return data ? JSON.parse(data) : null;
      })
    );
    
    return requests.filter(Boolean);
  } catch (error) {
    console.error('Error getting critical requests:', error);
    return [];
  }
}

/**
 * Get performance summary for all endpoints
 */
async function getPerformanceSummary() {
  try {
    // Use SCAN to find all endpoint stats
    let cursor = '0';
    let allStats = [];
    
    do {
      const [newCursor, keys] = await redis.scan(cursor, {
        match: 'perf:stats:*',
        count: 100
      });
      cursor = newCursor;
      
      if (keys.length > 0) {
        const statsData = await Promise.all(keys.map(key => redis.get(key)));
        const parsedStats = statsData
          .filter(Boolean)
          .map(data => JSON.parse(data));
        allStats.push(...parsedStats);
      }
    } while (cursor !== '0');
    
    // Sort by average duration (slowest first)
    allStats.sort((a, b) => b.avgDuration - a.avgDuration);
    
    return allStats;
  } catch (error) {
    console.error('Error getting performance summary:', error);
    return [];
  }
}

/**
 * Clear all performance data (for testing)
 */
async function clearPerformanceData() {
  try {
    let cursor = '0';
    let deletedCount = 0;
    
    do {
      const [newCursor, keys] = await redis.scan(cursor, {
        match: 'perf:*',
        count: 100
      });
      cursor = newCursor;
      
      if (keys.length > 0) {
        await redis.del(...keys);
        deletedCount += keys.length;
      }
    } while (cursor !== '0');
    
    console.log(`🗑️ Cleared ${deletedCount} performance records`);
    return deletedCount;
  } catch (error) {
    console.error('Error clearing performance data:', error);
    return 0;
  }
}

module.exports = performanceMonitor;
module.exports.getEndpointStats = getEndpointStats;
module.exports.getCriticalRequests = getCriticalRequests;
module.exports.getPerformanceSummary = getPerformanceSummary;
module.exports.clearPerformanceData = clearPerformanceData;
