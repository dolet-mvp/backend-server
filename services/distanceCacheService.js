/**
 * Google Maps Distance Caching Service
 * 
 * Purpose: Cache Google Maps API distance/duration results to reduce API calls and improve performance
 * 
 * Benefits:
 * - Reduces API costs (Google Maps charges per request)
 * - Improves response time: 500ms API call → 20ms Redis lookup (25x faster)
 * - Reduces external dependency failures
 * - Saves bandwidth
 * 
 * Cache Strategy:
 * - Key Format: `maps:distance:{originLat}:{originLng}:{destLat}:{destLng}`
 * - TTL: 24 hours (distances rarely change)
 * - Store: JSON with { distance, duration, timestamp }
 */

const redis = require('../config/redis/redis');

/**
 * Generate cache key for distance calculation
 * Round coordinates to 4 decimal places (~11 meters precision)
 * This allows cache hits for nearby coordinates
 */
function getCacheKey(originLat, originLng, destLat, destLng) {
  const roundedOriginLat = Number(originLat).toFixed(4);
  const roundedOriginLng = Number(originLng).toFixed(4);
  const roundedDestLat = Number(destLat).toFixed(4);
  const roundedDestLng = Number(destLng).toFixed(4);
  
  return `maps:distance:${roundedOriginLat}:${roundedOriginLng}:${roundedDestLat}:${roundedDestLng}`;
}

/**
 * Get cached distance result
 * @returns {Object|null} { distanceInMeters, durationInSeconds, distanceText, durationText } or null if not cached
 */
async function getCachedDistance(originLat, originLng, destLat, destLng) {
  try {
    const cacheKey = getCacheKey(originLat, originLng, destLat, destLng);
    const cached = await redis.get(cacheKey);
    
    if (cached && typeof cached === 'string') {
      try {
        const data = JSON.parse(cached);
        console.log(`🎯 Cache HIT: ${cacheKey} (saved API call)`);
        return data;
      } catch (parseError) {
        console.warn(`⚠️ Invalid JSON in cache for ${cacheKey}, clearing...`);
        await redis.del(cacheKey);
        return null;
      }
    }
    
    console.log(`⚠️ Cache MISS: ${cacheKey}`);
    return null;
  } catch (error) {
    console.error('❌ Error getting cached distance:', error);
    return null; // Fail gracefully, will fetch from API
  }
}

/**
 * Cache distance result
 * TTL: 24 hours (86400 seconds)
 */
async function cacheDistance(originLat, originLng, destLat, destLng, distanceData) {
  try {
    const cacheKey = getCacheKey(originLat, originLng, destLat, destLng);
    const dataToCache = {
      ...distanceData,
      cachedAt: Date.now()
    };
    
    // Cache for 24 hours
    await redis.setex(cacheKey, 86400, JSON.stringify(dataToCache));
    console.log(`💾 Cached distance: ${cacheKey} (expires in 24h)`);
  } catch (error) {
    console.error('❌ Error caching distance:', error);
    // Don't throw - caching failure shouldn't break the request
  }
}

/**
 * Batch cache multiple distances
 * Use this when caching results from Google Maps Distance Matrix API
 */
async function batchCacheDistances(distanceResults) {
  try {
    const cacheOperations = distanceResults.map(result => {
      const { originLat, originLng, destLat, destLng, distanceData } = result;
      const cacheKey = getCacheKey(originLat, originLng, destLat, destLng);
      const dataToCache = {
        ...distanceData,
        cachedAt: Date.now()    
      };
      
      return redis.setex(cacheKey, 86400, JSON.stringify(dataToCache));
    });
    
    await Promise.all(cacheOperations);
    console.log(`💾 Batch cached ${distanceResults.length} distances`);
  } catch (error) {
    console.error('❌ Error batch caching distances:', error);
  }
}

/**
 * Get cache statistics
 * Useful for monitoring cache hit rate
 */
async function getCacheStats() {
  try {
    // Use SCAN to find all distance cache keys (non-blocking)
    let cursor = '0';
    let totalKeys = 0;
    
    do {
      const [newCursor, keys] = await redis.scan(cursor, {
        match: 'maps:distance:*',
        count: 100
      });
      cursor = newCursor;
      totalKeys += keys.length;
    } while (cursor !== '0');
    
    return {
      totalCachedDistances: totalKeys,
      estimatedMemoryUsage: `${(totalKeys * 0.5).toFixed(2)} KB` // ~500 bytes per entry
    };
  } catch (error) {
    console.error('❌ Error getting cache stats:', error);
    return { totalCachedDistances: 0, estimatedMemoryUsage: '0 KB' };
  }
}

/**
 * Clear all distance cache (for testing or maintenance)
 */
async function clearDistanceCache() {
  try {
    let cursor = '0';
    let deletedCount = 0;
    
    do {
      const [newCursor, keys] = await redis.scan(cursor, {
        match: 'maps:distance:*',
        count: 100
      });
      cursor = newCursor;
      
      if (keys.length > 0) {
        await redis.del(...keys);
        deletedCount += keys.length;
      }
    } while (cursor !== '0');
    
    console.log(`🗑️ Cleared ${deletedCount} cached distances`);
    return deletedCount;
  } catch (error) {
    console.error('❌ Error clearing distance cache:', error);
    return 0;
  }
}

module.exports = {
  getCachedDistance,
  cacheDistance,
  batchCacheDistances,
  getCacheStats,
  clearDistanceCache
};
