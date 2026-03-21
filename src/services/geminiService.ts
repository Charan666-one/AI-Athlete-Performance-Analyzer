import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { classifyAthlete } from "./classifierService";

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, initialDelay = 2000): Promise<T> {
  let retries = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      const isRateLimit = error?.status === 429 || 
                         error?.message?.includes("429") || 
                         error?.message?.includes("RESOURCE_EXHAUSTED") ||
                         error?.message?.includes("quota") ||
                         error?.message?.includes("Rate limit");
      
      if (isRateLimit && retries < maxRetries) {
        const delay = initialDelay * Math.pow(2, retries);
        console.warn(`Rate limit hit. Retrying in ${delay}ms... (Attempt ${retries + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        retries++;
        continue;
      }
      throw error;
    }
  }
}

export const getGeminiResponse = async (prompt: string): Promise<string> => {
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("No Gemini API key found in process.env.API_KEY or process.env.GEMINI_API_KEY");
    throw new Error("GEMINI_API_KEY is not set.");
  }

  return withRetry(async () => {
    const ai = new GoogleGenAI({ apiKey });
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: "You are Nexus AI, a highly intelligent and creative workspace assistant. You help users brainstorm ideas, summarize notes, and organize their creative projects. Your tone is professional, encouraging, and sophisticated. Keep responses concise and insightful.",
      },
    });

    return response.text || "I'm sorry, I couldn't generate a response.";
  });
};

export const analyzeAthleteHealth = async (data: {
  name: string;
  age: number;
  sport: string;
  vitals: {
    heartRate: number;
    bloodPressure: string;
    testosterone: number;
    hematocrit: number;
    weightChange: number;
    symptoms: string;
  }
}): Promise<{ analysis: string; status: 'Ready' | 'Caution' | 'Suspicious' }> => {
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");

  return withRetry(async () => {
    // Fast ML Pre-classification
    const mlStatus = classifyAthlete({
      age: data.age,
      heartRate: data.vitals.heartRate,
      testosterone: data.vitals.testosterone,
      hematocrit: data.vitals.hematocrit,
      weightChange: data.vitals.weightChange
    });

    const ai = new GoogleGenAI({ apiKey });
    const prompt = `
      Analyze this athlete's data. Our ML classifier flagged them as: **${mlStatus}**.
      
      Athlete: ${data.name} (${data.age}y, ${data.sport})
      Vitals: HR ${data.vitals.heartRate}bpm, BP ${data.vitals.bloodPressure}, Testo ${data.vitals.testosterone}ng/dL, Hct ${data.vitals.hematocrit}%, WtChange ${data.vitals.weightChange}kg.
      Symptoms: ${data.vitals.symptoms || "None reported"}

      Provide a concise 3-point medical assessment confirming or refining the ML status.
      End with: "Final Status: [Ready|Caution|Suspicious]"
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: `You are a Sports Medicine Physician. Our Random Forest ML model pre-classified this athlete as ${mlStatus}. Your job is to provide the clinical reasoning. Be extremely concise.`,
      },
    });

    const text = response.text || "";
    let status: 'Ready' | 'Caution' | 'Suspicious' = mlStatus;
    
    // Allow AI to override ML if it finds strong evidence in symptoms or BP
    if (text.toLowerCase().includes("final status: suspicious")) {
      status = 'Suspicious';
    } else if (text.toLowerCase().includes("final status: caution")) {
      status = 'Caution';
    } else if (text.toLowerCase().includes("final status: ready")) {
      status = 'Ready';
    }

    return { analysis: text, status };
  });
};
