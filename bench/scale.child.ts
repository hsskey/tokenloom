// Runs the scale and heap measurement in its own process so an expanded parent heap cannot skew it.
import { measureScale } from "./scale.bench";

process.stdout.write(JSON.stringify(measureScale()) + "\n");
