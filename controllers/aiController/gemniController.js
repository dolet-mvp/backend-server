const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');
const crypto = require('crypto');

// In-memory storage for enrichment tasks (use Redis in production)
const enrichmentCache = new Map();

// Vertex AI Configuration
const PROJECT_ID = process.env.VERTEX_PROJECT_ID || 'dolet-app';
const LOCATION = process.env.VERTEX_LOCATION || 'us-central1';
const SERVICE_ACCOUNT_KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

if (!PROJECT_ID) {
  console.error("VERTEX_PROJECT_ID not set in environment");
}

if (!GOOGLE_MAPS_API_KEY) {
  console.warn("⚠️ GOOGLE_MAPS_API_KEY not set - location enrichment will be disabled");
}

// Initialize Google Auth
let auth;
try {
  auth = new GoogleAuth({
    keyFilename: SERVICE_ACCOUNT_KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  console.log(" Google Auth initialized for Vertex AI");
} catch (err) {
  console.error(" Failed to initialize Google Auth:", err.message);
}

const prewrittenDescription = `this above is user written description to craete its job on my platform , can you give me json filds in my model with above intents , you can leave which data is not provided , fill steps there , title, short description, budget, category , estimateduration , date, priority, location, from below model , and give me json fields with above intents and leave rest as empty or null so that user can edit after your json 
//
// title: {
//   type: DataTypes.STRING,
//   allowNull: false,
// },
// description: {
//   type: DataTypes.TEXT,
//   allowNull: false,
// },
//
// category: {
//   type: DataTypes.STRING,
//   allowNull: false,
// },
//
// budget: {
//   type: DataTypes.DECIMAL(10, 2),
//   allowNull: false,
// },
// estimatedDuration: {
//   type: DataTypes.INTEGER,
//   allowNull: true,
// },
// dueDate: {
//   type: DataTypes.DATE,
//   allowNull: true,
// },
// priority: {
//   type: DataTypes.ENUM("low", "medium", "high", "urgent"),
//   defaultValue: "medium",
// },
// status: {
//   type: DataTypes.ENUM(
//     "draft",
//     "published",
//     "in_queue",
//     "assigned",
//     "in_progress", 
//     "completed",
//     "cancelled",
//     "disputed"
//   ),
//   defaultValue: "draft",
// },
//
// location: {
//   type: DataTypes.JSON, // {address, lat, lng, city, state}
//   allowNull: true,
// },
//
// attachments: {
//   type: DataTypes.JSON, // Array of file URLs
//   allowNull: true,
// },
// requirements: {
//   type: DataTypes.TEXT,
//   allowNull: true,
// },
//
// isUrgent: {
//   type: DataTypes.BOOLEAN,
//   defaultValue: false,
// },
//
// steps: {
//   type: DataTypes.JSON, 
//   allowNull: true,
//   defaultValue: [],
//   comment: "Task steps/milestones - can be dynamically added by user"
//   AI generates format: [
//     { "id": 1, "description": "Step description here", "location": "SBI Bank Shibpur" }, 
//     { "id": 2, "description": "Another step", "location": null }
//   ]
//   After enrichment with Google Places API: [
//     { 
//       "id": 1, 
//       "description": "Step description", 
//       "location": "SBI Bank Shibpur",
//       "locationDetails": {
//         "address": "SBI Besu Branch, Shibpur, Howrah, West Bengal",
//         "lat": 22.5726,
//         "lng": 88.3639,
//         "placeId": "ChIJ...",
//         "name": "State Bank of India",
//         "mapUrl": "https://www.google.com/maps/search/?api=1&query=..."
//       }
//     }
//   ]
// }
`;




function extractAiText(response) {
  try {
    const candidates = response?.candidates;
    if (Array.isArray(candidates) && candidates.length > 0) {
      const parts = candidates[0]?.content?.parts;
      if (Array.isArray(parts) && parts.length > 0) {
        return parts[0]?.text || null;
      }
    }
    return null;
  } catch (err) {
    console.error("Error extracting AI text:", err);
    return null;
  }
}


async function getAccessToken() {
  try {
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    return tokenResponse.token;
  } catch (err) {
    console.error("Failed to get access token:", err);
    throw new Error('Authentication failed: ' + err.message);
  }
}


async function generateWithVertexAI(prompt) {
  // Try Gemini 2.5 models first (newest), then fallback to 1.5
  const modelNames = [
    "gemini-2.5-pro", "gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-pro"
  ];

  let lastError = null;
  
  // Get OAuth2 access token
  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    throw new Error('Failed to authenticate with Google Cloud: ' + err.message);
  }
  
  for (const modelName of modelNames) {
    try {
      console.log(` Trying Vertex AI model: ${modelName}`);
      
      // Vertex AI REST API endpoint
      const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${modelName}:generateContent`;
      
      console.log(`📍 Endpoint: ${endpoint}`);
      
      const requestBody = {
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
      };

      const response = await axios.post(endpoint, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: 30000
      });

      console.log(` Model ${modelName} succeeded`);
      return response.data;
      
    } catch (err) {
      lastError = err;
      const errorMsg = err?.response?.data?.error?.message || err.message;
      const errorStatus = err?.response?.status;
      console.warn(` Model ${modelName} failed (${errorStatus}):`, errorMsg);
      
      // Log more details for debugging
      if (err?.response?.data) {
        console.warn('Full error response:', JSON.stringify(err.response.data, null, 2));
      }
    }
  }

  throw lastError || new Error('All Vertex AI models failed');
}

const generateTaskJson = async (req, res) => {
  console.log('\n🚀 [STEP 1] Starting AI Task Generation');
  
  try {
    // Validate configuration
    console.log('🔍 [STEP 2] Validating configuration...');
    
    if (!PROJECT_ID) {
      console.error('❌ Validation failed: PROJECT_ID missing');
      return res.status(500).json({
        success: false,
        message: "Server configuration error: VERTEX_PROJECT_ID missing.",
      });
    }

    if (!auth) {
      console.error('❌ Validation failed: Google Auth not initialized');
      return res.status(500).json({
        success: false,
        message: "Server configuration error: Google Auth not initialized. Please set GOOGLE_APPLICATION_CREDENTIALS.",
      });
    }
    
    console.log('✅ Configuration validated');

    // Validate request
    console.log('🔍 [STEP 3] Validating user input...');
    const userDescription = req.body?.description ?? req.body?.text ?? null;
    
    if (!userDescription || typeof userDescription !== "string" || userDescription.trim() === "") {
      console.error('❌ Validation failed: Description missing or invalid');
      return res.status(400).json({ 
        success: false, 
        message: "Description required in request body." 
      });
    }
    
    console.log(`✅ User description received: "${userDescription.substring(0, 50)}..."`);

    // Build prompt
    console.log('📝 [STEP 4] Building AI prompt...');
    const prompt = `
User description:
"${userDescription}"

Prewritten description:
"${prewrittenDescription}"

Please combine these and return a single, valid JSON object for a job/task with exactly the following fields:
title, description, category, budget, estimatedDuration, dueDate, priority, location, steps.
- Fill the fields you can from the descriptions.
- If a field cannot be inferred, set it to null.
- "steps" is REQUIRED and MUST contain at least 1 step. Break down the task into logical steps.
- "steps" MUST be an array of step objects with this EXACT format:
  [
    { "id": 1, "description": "First step description", "location": "Specific location for this step" },
    { "id": 2, "description": "Second step description", "location": null }
  ]
  Each step object MUST have these fields:
  - "id" (number): Sequential ID starting from 1
  - "description" (string): Clear description of the step
  - "location" (string or null): Include specific location ONLY if that step requires a specific place/address. If the step doesn't need a specific location, set to null.
  
  IMPORTANT: If the task description mentions specific locations for certain steps (like "go to SBI Bank", "visit the shop", etc.), include that location information in the relevant step's location field.
  
  Minimum 1 step is required.
- Respond ONLY with the JSON object (do not add explanatory text).
`;
    
    console.log('✅ Prompt built successfully');

    // Generate content using Vertex AI
    console.log('🤖 [STEP 5] Calling Vertex AI to generate task...');
    let aiResp = null;
    try {
      aiResp = await generateWithVertexAI(prompt);
      console.log('✅ AI response received');
    } catch (err) {
      console.error("❌ Vertex AI generation failed:", err.message);
      return res.status(500).json({
        success: false,
        message: "Failed to generate content with Vertex AI. Check server logs.",
        error: err?.message || String(err),
      });
    }

    // Extract text from response
    console.log('📄 [STEP 6] Extracting text from AI response...');
    const aiText = extractAiText(aiResp);
    
    if (!aiText) {
      console.error('❌ No text content found in AI response');
      return res.status(500).json({
        success: false,
        message: "No text content in AI response",
        response: aiResp,
      });
    }
    
    console.log(`✅ Text extracted (${aiText.length} characters)`);

    // Parse JSON from AI response
    console.log('🔄 [STEP 7] Parsing JSON from AI text...');
    let taskJson = null;
    
    try {
      taskJson = JSON.parse(aiText);
      console.log('✅ JSON parsed successfully');
    } catch (err) {
      console.log('⚠️  Direct parse failed, trying to extract from markdown...');
      
      // Try to extract JSON from markdown code blocks or other formatting
      const match = aiText.match(/```json\s*([\s\S]*?)\s*```/) || 
                    aiText.match(/```\s*([\s\S]*?)\s*```/) ||
                    aiText.match(/(\{[\s\S]*\})/);
      
      if (match) {
        try {
          taskJson = JSON.parse(match[1] || match[0]);
          console.log('✅ JSON extracted from markdown and parsed');
        } catch (err2) {
          console.error("❌ Failed to parse extracted JSON:", err2.message);
        }
      }
    }

    if (!taskJson) {
      console.error('❌ Could not parse AI response as JSON');
      return res.status(500).json({
        success: false,
        message: "AI response is not valid JSON",
        aiText,
      });
    }

    // Ensure steps is an array
    console.log('🔍 [STEP 8] Validating task structure...');
    if (!Array.isArray(taskJson.steps)) {
      console.warn('⚠️  Steps is not an array, converting to empty array');
      taskJson.steps = [];
    }
    
    // Add default values for required fields to prevent null 
    
    // Generate unique task ID
    const taskId = crypto.randomUUID();
    console.log(`🔑 Generated task ID: ${taskId}`);
    
    // Store initial task data in cache
    enrichmentCache.set(taskId, {
      status: 'pending',
      taskData: taskJson,
      enrichedSteps: null,
      createdAt: new Date()
    });
    
    console.log('✨ [STEP 9] Sending initial response to client...');
    
    // Send immediate response with taskId
    const response = {
      success: true,
      taskId: taskId,
      data: taskJson,
      enrichmentStatus: 'pending',
      message: 'Task generated. Location enrichment in progress...'
    };
    
    // Trigger background enrichment (don't await)
    console.log('🔄 [STEP 10] Triggering background location enrichment...');
    enrichLocationsInBackground(taskId, taskJson.steps).catch(err => {
      console.error('❌ Background enrichment failed:', err.message);
    });

    return res.status(200).json(response);

  } catch (error) {
    console.error("❌ [ERROR] generateTaskJson failed:", error.message);
    return res.status(500).json({ 
      success: false, 
      message: "Internal Server Error", 
      error: error?.message ?? String(error) 
    });
  }
};


/**
 * Fetch precise location details using Google Places API
 * @param {string} locationQuery - Location search query (e.g., "SBI Bank Shibpur")
 * @returns {Object} Location details with lat, lng, formatted address, place_id, and map URL
 */
async function fetchLocationDetails(locationQuery) {
  if (!GOOGLE_MAPS_API_KEY) {
    return null;
  }

  try {
    // Use Google Places Text Search API
    const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json`;
    
    console.log(`      📡 Calling Google Places API...`);
    const response = await axios.get(searchUrl, {
      params: {
        query: locationQuery,
        key: GOOGLE_MAPS_API_KEY
      }
    });

    console.log(`      📊 API Status: ${response.data.status}, Results: ${response.data.results?.length || 0}`);

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const place = response.data.results[0];
      
      console.log(`      ✅ Found: ${place.name} at ${place.formatted_address}`);
      
      return {
        address: place.formatted_address,
        lat: place.geometry.location.lat,
        lng: place.geometry.location.lng,
        placeId: place.place_id,
        name: place.name,
        // Google Maps URL for direct navigation
        mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.formatted_address)}&query_place_id=${place.place_id}`
      };
    }

    console.log(`      ⚠️  No results found`);
    return null;
  } catch (error) {
    console.error(`      ❌ Error: ${error.message}`);
    return null;
  }
}


/**
 * Enrich steps with precise location details from Google Places API
 * Adds full location object with coordinates and map URL to each step
 */
const enrichStepsWithLocations = async (req, res) => {
  console.log('\n📍 [STEP 1] Starting Location Enrichment');
  
  try {
    console.log('🔍 [STEP 2] Checking Google Maps API configuration...');
    
    if (!GOOGLE_MAPS_API_KEY) {
      console.error('❌ Google Maps API key not configured');
      return res.status(500).json({
        success: false,
        message: "Google Maps API key not configured. Please set GOOGLE_MAPS_API_KEY in environment."
      });
    }
    
    console.log('✅ Google Maps API key found');

    console.log('🔍 [STEP 3] Validating request body...');
    const { steps } = req.body;

    if (!Array.isArray(steps) || steps.length === 0) {
      console.error('❌ Invalid steps array');
      return res.status(400).json({
        success: false,
        message: "Steps array is required in request body"
      });
    }
    
    console.log(`✅ Received ${steps.length} steps to enrich`);

    console.log(`✅ Received ${steps.length} steps to enrich`);

    // Process each step and fetch location details if location string exists
    console.log('🌍 [STEP 4] Fetching location details from Google Places...');
    
    const enrichedSteps = await Promise.all(
      steps.map(async (step, index) => {
        console.log(`   Processing step ${index + 1}/${steps.length}: ${step.description?.substring(0, 40)}...`);
        
        // If step has a location string, fetch precise details
        if (step.location && typeof step.location === 'string') {
          console.log(`   🔍 Searching for: "${step.location}"`);
          const locationDetails = await fetchLocationDetails(step.location);
          
          if (locationDetails) {
            console.log(`   ✅ Location found: ${locationDetails.name}`);
          } else {
            console.log(`   ⚠️  Location not found, using original string`);
          }
          
          return {
            ...step,
            locationDetails: locationDetails || {
              address: step.location,
              lat: null,
              lng: null,
              placeId: null,
              name: null,
              mapUrl: null
            }
          };
        }
        
        // If no location, return step as-is with null locationDetails
        console.log(`   ℹ️  No location to fetch`);
        return {
          ...step,
          locationDetails: null
        };
      })
    );

    console.log('✅ All locations processed');
    
    console.log('✨ [STEP 5] Sending enriched steps to client...');
    return res.status(200).json({
      success: true,
      data: {
        steps: enrichedSteps
      }
    });

  } catch (error) {
    console.error("❌ [ERROR] enrichStepsWithLocations failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error?.message ?? String(error)
    });
  }
};


/**
 * Background function to enrich locations without blocking the response
 */
async function enrichLocationsInBackground(taskId, steps) {
  console.log(`\n🔄 [BACKGROUND] Starting enrichment for task ${taskId}`);
  
  try {
    if (!GOOGLE_MAPS_API_KEY) {
      console.warn('⚠️  Google Maps API key not configured, skipping enrichment');
      enrichmentCache.set(taskId, {
        ...enrichmentCache.get(taskId),
        status: 'skipped',
        enrichedSteps: steps.map(step => ({ ...step, locationDetails: null }))
      });
      return;
    }

    const enrichedSteps = await Promise.all(
      steps.map(async (step, index) => {
        if (step.location && typeof step.location === 'string') {
          console.log(`   🔍 [BACKGROUND] Fetching location for step ${index + 1}: "${step.location}"`);
          const locationDetails = await fetchLocationDetails(step.location);
          
          return {
            ...step,
            locationDetails: locationDetails || {
              address: step.location,
              lat: null,
              lng: null,
              placeId: null,
              name: null,
              mapUrl: null
            }
          };
        }
        
        return {
          ...step,
          locationDetails: null
        };
      })
    );

    // Update cache with enriched data
    const cachedData = enrichmentCache.get(taskId);
    if (cachedData) {
      enrichmentCache.set(taskId, {
        ...cachedData,
        status: 'completed',
        enrichedSteps: enrichedSteps,
        completedAt: new Date()
      });
      console.log(` [BACKGROUND] Enrichment completed for task ${taskId}`);
    }

  } catch (error) {
    console.error(`❌ [BACKGROUND] Enrichment failed for task ${taskId}:`, error.message);
    
    const cachedData = enrichmentCache.get(taskId);
    if (cachedData) {
      enrichmentCache.set(taskId, {
        ...cachedData,
        status: 'failed',
        error: error.message
      });
    }
  }
}



const getEnrichedTask = async (req, res) => {
  console.log('\n📥 [FETCH] Getting enriched task data');
  
  try {
    const { taskId } = req.params;
    
    console.log(`🔍 Looking for task: ${taskId}`);

    if (!taskId) {
      console.error('❌ Task ID missing');
      return res.status(400).json({
        success: false,
        message: "Task ID is required"
      });
    }

    const cachedData = enrichmentCache.get(taskId);

    if (!cachedData) {
      console.error('❌ Task not found in cache');
      return res.status(404).json({
        success: false,
        message: "Task not found or expired"
      });
    }

    console.log(`📊 Task status: ${cachedData.status}`);

    // Return data based on status
    if (cachedData.status === 'completed') {
      console.log('✅ Returning completed enriched data');
      return res.status(200).json({
        success: true,
        status: 'completed',
        data: {
          ...cachedData.taskData,
          steps: cachedData.enrichedSteps
        }
      });
    } else if (cachedData.status === 'pending') {
      console.log('⏳ Enrichment still in progress');
      return res.status(200).json({
        success: true,
        status: 'pending',
        message: 'Location enrichment in progress',
        data: cachedData.taskData
      });
    } else if (cachedData.status === 'failed') {
      console.log('⚠️  Enrichment failed, returning original data');
      return res.status(200).json({
        success: true,
        status: 'failed',
        message: 'Location enrichment failed',
        error: cachedData.error,
        data: cachedData.taskData
      });
    } else if (cachedData.status === 'skipped') {
      console.log('ℹ️  Enrichment skipped');
      return res.status(200).json({
        success: true,
        status: 'skipped',
        message: 'Location enrichment skipped (no API key)',
        data: {
          ...cachedData.taskData,
          steps: cachedData.enrichedSteps
        }
      });
    }

  } catch (error) {
    console.error("❌ [ERROR] getEnrichedTask failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error?.message ?? String(error)
    });
  }
};


// Clean up old cache entries every 10 minutes
setInterval(() => {
  const now = new Date();
  let cleanedCount = 0;
  
  for (const [taskId, data] of enrichmentCache.entries()) {
    const age = now - data.createdAt;
    // Remove entries older than 1 hour
    if (age > 60 * 60 * 1000) {
      enrichmentCache.delete(taskId);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`🧹 Cleaned ${cleanedCount} old cache entries`);
  }
}, 10 * 60 * 1000);


module.exports = {
  generateTaskJson,
  enrichStepsWithLocations,
  getEnrichedTask,
};
