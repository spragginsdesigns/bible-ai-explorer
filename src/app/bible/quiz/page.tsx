import { Suspense } from "react";
import QuizScreen from "@/components/quiz/QuizScreen";

export default function BibleQuizPage() {
  return (
    <Suspense>
      <QuizScreen />
    </Suspense>
  );
}
