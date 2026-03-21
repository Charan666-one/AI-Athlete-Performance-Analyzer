import { RandomForestClassifier } from 'ml-random-forest';

// Features: [age, heartRate, testosterone, hematocrit, weightChange]
// Labels: 0: Ready, 1: Caution, 2: Suspicious

const generateSyntheticData = () => {
  const data: number[][] = [];
  const labels: number[] = [];

  // Generate 2000 samples for each class for extreme accuracy
  for (let i = 0; i < 2000; i++) {
    // Ready (Healthy)
    data.push([
      18 + Math.random() * 22, // age 18-40
      40 + Math.random() * 30, // HR 40-70
      300 + Math.random() * 500, // Testo 300-800
      37 + Math.random() * 10, // Hct 37-47
      -1.5 + Math.random() * 3, // WtChange -1.5 to 1.5
    ]);
    labels.push(0);

    // Caution (Mildly abnormal / Overtraining)
    data.push([
      18 + Math.random() * 45, // age 18-63
      70 + Math.random() * 35, // HR 70-105
      800 + Math.random() * 300, // Testo 800-1100
      47 + Math.random() * 6, // Hct 47-53
      2 + Math.random() * 5, // WtChange 2 to 7
    ]);
    labels.push(1);

    // Suspicious (Extreme indicators / PED use)
    data.push([
      19 + Math.random() * 25, // age 19-44
      30 + Math.random() * 20, // HR 30-50
      1100 + Math.random() * 1400, // Testo 1100-2500
      53 + Math.random() * 12, // Hct 53-65
      7 + Math.random() * 15, // WtChange 7 to 22
    ]);
    labels.push(2);
  }
  return { data, labels };
};

const { data: trainingData, labels: trainingLabels } = generateSyntheticData();

// Pre-train the classifier with optimized parameters
const classifier = new RandomForestClassifier({
  nEstimators: 100, // 100 is the sweet spot for speed/accuracy balance
  treeOptions: {
    maxDepth: 25, // Deeper trees for very precise boundaries
  },
});
classifier.train(trainingData, trainingLabels);

// Reuse prediction array to avoid garbage collection overhead in tight loops
const predictionBuffer = [[0, 0, 0, 0, 0]];

export const classifyAthlete = (data: {
  age: number;
  heartRate: number;
  testosterone: number;
  hematocrit: number;
  weightChange: number;
}): 'Ready' | 'Caution' | 'Suspicious' => {
  predictionBuffer[0][0] = data.age;
  predictionBuffer[0][1] = data.heartRate;
  predictionBuffer[0][2] = data.testosterone;
  predictionBuffer[0][3] = data.hematocrit;
  predictionBuffer[0][4] = data.weightChange;

  const prediction = classifier.predict(predictionBuffer)[0];

  const statusMap: Record<number, 'Ready' | 'Caution' | 'Suspicious'> = {
    0: 'Ready',
    1: 'Caution',
    2: 'Suspicious',
  };

  return statusMap[prediction as number] || 'Caution';
};
