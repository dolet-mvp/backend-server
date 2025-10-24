const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');

// Vertex AI Configuration
const PROJECT_ID = process.env.VERTEX_PROJECT_ID || 'dolet-app';
const LOCATION = process.env.VERTEX_LOCATION || 'us-central1';
const SERVICE_ACCOUNT_KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!PROJECT_ID) {
  console.error("VERTEX_PROJECT_ID not set in environment");
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
//   format: [{ "id": 1, "description": "Step description here" }, { "id": 2, "description": "Another step" }]
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
  try {
    // Validate configuration
    if (!PROJECT_ID) {
      return res.status(500).json({
        success: false,
        message: "Server configuration error: VERTEX_PROJECT_ID missing.",
      });
    }

    if (!auth) {
      return res.status(500).json({
        success: false,
        message: "Server configuration error: Google Auth not initialized. Please set GOOGLE_APPLICATION_CREDENTIALS.",
      });
    }

    // Validate request
    const userDescription = req.body?.description ?? req.body?.text ?? null;
    if (!userDescription || typeof userDescription !== "string" || userDescription.trim() === "") {
      return res.status(400).json({ 
        success: false, 
        message: "Description required in request body." 
      });
    }

    // Build prompt
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
    { "id": 1, "description": "First step description" },
    { "id": 2, "description": "Second step description" }
  ]
  Each step object should have ONLY two fields: "id" (number) and "description" (string).
  Generate sequential step IDs starting from 1.
  Minimum 1 step is required.
- Respond ONLY with the JSON object (do not add explanatory text).
`;

    // Generate content using Vertex AI
    let aiResp = null;
    try {
      aiResp = await generateWithVertexAI(prompt);
    } catch (err) {
      console.error("Vertex AI generation failed:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to generate content with Vertex AI. Check server logs.",
        error: err?.message || String(err),
      });
    }

    // Extract text from response
    const aiText = extractAiText(aiResp);
    if (!aiText) {
      return res.status(500).json({
        success: false,
        message: "No text content in AI response",
        response: aiResp,
      });
    }

    // Parse JSON from AI response
    let taskJson = null;
    try {
      taskJson = JSON.parse(aiText);
    } catch (err) {
      // Try to extract JSON from markdown code blocks or other formatting
      const match = aiText.match(/```json\s*([\s\S]*?)\s*```/) || 
                    aiText.match(/```\s*([\s\S]*?)\s*```/) ||
                    aiText.match(/(\{[\s\S]*\})/);
      
      if (match) {
        try {
          taskJson = JSON.parse(match[1] || match[0]);
        } catch (err2) {
          console.error("Failed to parse JSON from AI text:", err2);
        }
      }
    }

    if (!taskJson) {
      return res.status(500).json({
        success: false,
        message: "AI response is not valid JSON",
        aiText,
      });
    }

    // Ensure steps is an array
    if (!Array.isArray(taskJson.steps)) {
      taskJson.steps = [];
    }

    return res.status(200).json({ 
      success: true, 
      data: taskJson 
    });

  } catch (error) {
    console.error("generateTaskJson error:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Internal Server Error", 
      error: error?.message ?? String(error) 
    });
  }
};

module.exports = {
  generateTaskJson,
};
