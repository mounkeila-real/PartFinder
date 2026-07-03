import * as fs from 'fs';
import * as path from 'path';

const makesModels = {
    'Renault': ['Clio', 'Mégane', 'Captur', 'Zoe', 'Scenic', 'Kangoo', 'Laguna'],
    'Peugeot': ['208', '308', '508', '2008', '3008', '5008'],
    'Citroën': ['C3', 'C4', 'C5', 'Berlingo', 'C1', 'C3 Aircross'],
    'Audi': ['A1', 'A3', 'A4', 'A5', 'A6', 'Q3', 'Q5', 'TT'],
    'BMW': ['Série 1', 'Série 2', 'Série 3', 'Série 4', 'Série 5', 'X1', 'X3', 'X5'],
    'Volkswagen': ['Golf', 'Polo', 'Passat', 'Tiguan', 'Touran', 'Caddy'],
    'Mercedes-Benz': ['Classe A', 'Classe B', 'Classe C', 'Classe E', 'Classe S', 'GLA', 'GLC', 'GLE'],
    'Fiat': ['500', 'Panda', 'Punto', 'Tipo', 'Doblo']
};

const years = Array.from({ length: 17 }, (_, i) => 2010 + i); // 2010 to 2026

const data: { year: number; make: string; model: string }[] = [];

for (const [make, models] of Object.entries(makesModels)) {
    for (const model of models) {
        for (const year of years) {
            data.push({ year, make, model });
        }
    }
}

const dir = path.join(__dirname, '..', 'tmp_vehicle_data');
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
}

fs.writeFileSync(
    path.join(dir, 'json_data.json'),
    JSON.stringify(data, null, 2),
    'utf8'
);

console.log(`Generated ${data.length} vehicle records.`);
