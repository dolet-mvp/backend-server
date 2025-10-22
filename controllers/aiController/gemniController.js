const axios = require("axios");

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY not set in environment");
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
// }
`;


function extractAiText(responseData) {
  try {
    const p1 = responseData?.candidates?.[0]?.content?.parts?.[0]?.text
      || responseData?.candidates?.[0]?.content?.[0]?.text;
    if (p1) return p1;

    const p2 = responseData?.output?.[0]?.content?.[0]?.text
      || responseData?.output?.[0]?.content?.text;
    if (p2) return p2;

    if (Array.isArray(responseData?.candidates)) {
      const candidateStrings = responseData.candidates
        .map((c) => {
          if (typeof c === "string") return c;
          if (c?.content?.parts?.[0]?.text) return c.content.parts[0].text;
          return null;
        })
        .filter(Boolean);
      if (candidateStrings.length) return candidateStrings.join("\n\n");
    }

    if (typeof responseData?.text === "string") return responseData.text;
    if (typeof responseData?.content === "string") return responseData.content;

    return JSON.stringify(responseData);
  } catch (err) {
    return null;
  }
}

async function listAvailableModels() {
  const url = `${BASE_URL}/models?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const resp = await axios.get(url, { timeout: 10000 });
  return resp.data?.models || [];
}

async function tryGenerateWithModel(modelName, prompt) {
  const url = `${BASE_URL}/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
  };
  const resp = await axios.post(url, body, {
    headers: { "Content-Type": "application/json" },
    timeout: 20000,
  });
  return resp.data;
}

const generateTaskJson = async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        message: "Server configuration error: GEMINI_API_KEY missing.",
      });
    }

    const userDescription = req.body?.description ?? req.body?.text ?? null;
    if (!userDescription || typeof userDescription !== "string" || userDescription.trim() === "") {
      return res.status(400).json({ success: false, message: "Description required in request body." });
    }

    const prompt = `
User description:
"${userDescription}"

Prewritten description:
"${prewrittenDescription}"

Please combine these and return a single, valid JSON object for a job/task with exactly the following fields:
title, description, category, budget, estimatedDuration, dueDate, priority, location, steps.
- Fill the fields you can from the descriptions.
- If a field cannot be inferred, set it to null (or [] for steps).
- "steps" should be an array of step objects (or an empty array).
- Respond ONLY with the JSON object (do not add explanatory text).
`;

    let models = [];
    try {
      models = await listAvailableModels();
    } catch (err) {
      console.warn("Warning: listing models failed, will try fallbacks. Error:", err?.response?.data ?? err.message ?? err);
    }
    const candidateNames = (models.map(m => m.name || m).filter(Boolean))
      .map(n => n.replace(/^models\//i, ""))
      .filter(n => /gemini/i.test(n));

    if (!candidateNames.length) {
      candidateNames.push("gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-flash", "gemini-1.5-pro");
    }

    let aiResp = null;
    let lastError = null;
    for (const modelName of candidateNames) {
      try {
        console.log(`Trying model: ${modelName}`);
        const data = await tryGenerateWithModel(modelName, prompt);
        aiResp = data;
        console.log(`Model ${modelName} succeeded.`);
        break;
      } catch (err) {
        lastError = err;
        console.warn(`Model ${modelName} failed:`, err?.response?.data ?? err.message ?? err);
      }
    }

    if (!aiResp) {
      console.error("All model attempts failed. Last error:", lastError?.response?.data ?? lastError?.message ?? lastError);
      return res.status(500).json({
        success: false,
        message: "No available Gemini model worked for generateContent. Check server logs.",
        lastError: lastError?.response?.data ?? lastError?.message ?? String(lastError),
      });
    }
    const aiText = extractAiText(aiResp) ?? "";
    let taskJson = null;
    try {
      taskJson = JSON.parse(aiText);
    } catch (err) {
      const match = aiText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (match) {
        try {
          taskJson = JSON.parse(match[0]);
        } catch (err2) {
          console.error("Failed to parse JSON substring from AI text:", err2);
        }
      }
    }

    if (!taskJson) {
      return res.status(500).json({
        success: false,
        message: "AI response not valid JSON",
        aiText,
      });
    }

    if (!Array.isArray(taskJson.steps)) taskJson.steps = [];

    return res.status(200).json({ success: true, data: taskJson });
  } catch (error) {
    console.error("generateTaskJson error:", error?.response?.data ?? error.message ?? error);
    return res.status(500).json({ success: false, message: "Internal Server Error", error: error?.message ?? String(error) });
  }
};

module.exports = {
  generateTaskJson,
};
