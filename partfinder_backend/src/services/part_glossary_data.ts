import type { Entry } from './part_glossary';

/**
 * Glossaire importé — GÉNÉRÉ, ne pas modifier à la main.
 *
 * Source  : glossaire_pieces.csv
 * Régénérer : node scripts/import_glossaire_csv.js <fichier.csv>
 *
 * 124 termes.
 * ⚠️ 124 sans traduction italienne : pour ces termes, le marché
 * italien n'est PAS interrogé (une requête « undefined … » serait pire qu'une
 * absence de résultat). Compléter la colonne italienne du CSV les activera.
 */
export const GLOSSAIRE_IMPORTE: Entry[] = [
    // Moteur
    { fr: ['Bloc moteur'], de: 'Motorblock', es: 'Bloque motor', it: null, en: 'Engine block' },
    // Moteur
    { fr: ['Culasse'], de: 'Zylinderkopf', es: 'Culata', it: null, en: 'Cylinder head' },
    // Moteur
    { fr: ['Arbre à cames'], de: 'Nockenwelle', es: 'Árbol de levas', it: null, en: 'Camshaft' },
    // Moteur
    { fr: ['Vilebrequin'], de: 'Kurbelwelle', es: 'Cigüeñal', it: null, en: 'Crankshaft' },
    // Moteur
    { fr: ['Piston'], de: 'Kolben', es: 'Pistón', it: null, en: 'Piston' },
    // Moteur
    { fr: ['Bielle'], de: 'Pleuelstange', es: 'Biela', it: null, en: 'Connecting rod' },
    // Moteur
    { fr: ['Segment de piston'], de: 'Kolbenring', es: 'Anillo de pistón', it: null, en: 'Piston ring' },
    // Moteur
    { fr: ['Carter d\'huile'], de: 'Ölwanne', es: 'Cárter de aceite', it: null, en: 'Oil pan' },
    // Moteur
    { fr: ['Soupape d\'admission'], de: 'Einlassventil', es: 'Válvula de admisión', it: null, en: 'Intake valve' },
    // Moteur
    { fr: ['Soupape d\'échappement'], de: 'Auslassventil', es: 'Válvula de escape', it: null, en: 'Exhaust valve' },
    // Moteur
    { fr: ['Poussoir hydraulique'], de: 'Hydrostößel', es: 'Taqué hidráulico', it: null, en: 'Hydraulic lifter' },
    // Moteur
    { fr: ['Joint de culasse'], de: 'Zylinderkopfdichtung', es: 'Junta de culata', it: null, en: 'Cylinder head gasket' },
    // Moteur
    { fr: ['Pompe à huile'], de: 'Ölpumpe', es: 'Bomba de aceite', it: null, en: 'Oil pump' },
    // Moteur
    { fr: ['Reniflard d\'huile'], de: 'Kurbelgehäuseentlüftung', es: 'Válvula PCV', it: null, en: 'PCV valve' },
    // Distribution
    { fr: ['Courroie de distribution'], de: 'Zahnriemen', es: 'Correa de distribución', it: null, en: 'Timing belt' },
    // Distribution
    { fr: ['Chaîne de distribution'], de: 'Steuerkette', es: 'Cadena de distribución', it: null, en: 'Timing chain' },
    // Distribution
    { fr: ['Galet tendeur'], de: 'Spannrolle', es: 'Rodillo tensor', it: null, en: 'Tensioner pulley' },
    // Distribution
    { fr: ['Galet enrouleur'], de: 'Umlenkrolle', es: 'Rodillo guía', it: null, en: 'Idler pulley' },
    // Distribution
    { fr: ['Courroie d\'accessoire'], de: 'Keilrippenriemen', es: 'Correa de accesorios', it: null, en: 'Serpentine belt' },
    // Distribution
    { fr: ['Poulie Damper'], de: 'Riemenscheibe', es: 'Polea del cigüeñal', it: null, en: 'Crankshaft pulley' },
    // Alimentation
    { fr: ['Pompe à carburant'], de: 'Kraftstoffpumpe', es: 'Bomba de combustible', it: null, en: 'Fuel pump' },
    // Alimentation
    { fr: ['Injecteur'], de: 'Einspritzventil', es: 'Inyector', it: null, en: 'Fuel injector' },
    // Alimentation
    { fr: ['Rampe d\'injection'], de: 'Kraftstoffverteilerrohr', es: 'Rampa de inyección', it: null, en: 'Fuel rail' },
    // Alimentation
    { fr: ['Régulateur de pression de carburant'], de: 'Kraftstoffdruckregler', es: 'Regulador de presión de combustible', it: null, en: 'Fuel pressure regulator' },
    // Alimentation
    { fr: ['Boîtier papillon'], de: 'Drosselklappe', es: 'Cuerpo de mariposa', it: null, en: 'Throttle body' },
    // Alimentation
    { fr: ['Réservoir de carburant'], de: 'Kraftstofftank', es: 'Depósito de combustible', it: null, en: 'Fuel tank' },
    // Alimentation
    { fr: ['Filtre à carburant'], de: 'Kraftstofffilter', es: 'Filtro de combustible', it: null, en: 'Fuel filter' },
    // Échappement
    { fr: ['Collecteur d\'échappement'], de: 'Abgaskrümmer', es: 'Colector de escape', it: null, en: 'Exhaust manifold' },
    // Échappement
    { fr: ['Turbocompresseur'], de: 'Turbolader', es: 'Turbocompresor', it: null, en: 'Turbocharger' },
    // Échappement
    { fr: ['Échangeur thermique (Intercooler)'], de: 'Ladeluftkühler', es: 'Intercooler', it: null, en: 'Intercooler' },
    // Échappement
    { fr: ['Catalyseur'], de: 'Katalysator', es: 'Catalizador', it: null, en: 'Catalytic converter' },
    // Échappement
    { fr: ['Filtre à particules (FAP)'], de: 'Partikelfilter (DPF)', es: 'Filtro de partículas', it: null, en: 'Particulate filter (DPF)' },
    // Échappement
    { fr: ['Sonde lambda'], de: 'Lambdasonde', es: 'Sonda lambda', it: null, en: 'Oxygen sensor (O2)' },
    // Échappement
    { fr: ['Vanne EGR'], de: 'AGR-Ventil', es: 'Válvula EGR', it: null, en: 'EGR valve' },
    // Échappement
    { fr: ['Silencieux central'], de: 'Mittelschalldämpfer', es: 'Silenciador central', it: null, en: 'Center muffler' },
    // Échappement
    { fr: ['Silencieux arrière'], de: 'Endschalldämpfer', es: 'Silenciador trasero', it: null, en: 'Rear muffler' },
    // Échappement
    { fr: ['Silentbloc d\'échappement'], de: 'Auspuffgummi', es: 'Soporte de escape', it: null, en: 'Exhaust hanger' },
    // Refroidissement
    { fr: ['Radiateur'], de: 'Wasserkühler', es: 'Radiador', it: null, en: 'Radiator' },
    // Refroidissement
    { fr: ['Thermostat'], de: 'Thermostat', es: 'Termostato', it: null, en: 'Thermostat' },
    // Refroidissement
    { fr: ['Pompe à eau'], de: 'Wasserpumpe', es: 'Bomba de agua', it: null, en: 'Water pump' },
    // Refroidissement
    { fr: ['Ventilateur de refroidissement'], de: 'Kühlerlüfter', es: 'Ventilador del radiador', it: null, en: 'Cooling fan' },
    // Refroidissement
    { fr: ['Vase d\'expansion'], de: 'Ausgleichsbehälter', es: 'Vaso de expansión', it: null, en: 'Expansion tank' },
    // Refroidissement
    { fr: ['Bouchon de radiateur'], de: 'Kühlerdeckel', es: 'Tapón del radiador', it: null, en: 'Radiator cap' },
    // Refroidissement
    { fr: ['Durite de radiateur'], de: 'Kühlerschlauch', es: 'Manguito de radiador', it: null, en: 'Radiator hose' },
    // Refroidissement
    { fr: ['Radiateur de chauffage'], de: 'Wärmetauscher', es: 'Radiador de calefacción', it: null, en: 'Heater core' },
    // Transmission
    { fr: ['Boîte de vitesses manuelle'], de: 'Schaltgetriebe', es: 'Caja de cambios manual', it: null, en: 'Manual transmission' },
    // Transmission
    { fr: ['Boîte de vitesses automatique'], de: 'Automatikgetriebe', es: 'Caja de cambios automática', it: null, en: 'Automatic transmission' },
    // Transmission
    { fr: ['Embrayage'], de: 'Kupplung', es: 'Embrague', it: null, en: 'Clutch' },
    // Transmission
    { fr: ['Volant moteur (Bi-masse)'], de: 'Zweimassenschwungrad', es: 'Volante bimasa', it: null, en: 'Dual-mass flywheel' },
    // Transmission
    { fr: ['Butée d\'embrayage'], de: 'Ausrücklager', es: 'Collarín de embrague', it: null, en: 'Release bearing' },
    // Transmission
    { fr: ['Émetteur d\'embrayage'], de: 'Kupplungsgeberzylinder', es: 'Cilindro emisor de embrague', it: null, en: 'Clutch master cylinder' },
    // Transmission
    { fr: ['Récepteur d\'embrayage'], de: 'Kupplungsnehmerzylinder', es: 'Cilindro receptor de embrague', it: null, en: 'Clutch slave cylinder' },
    // Transmission
    { fr: ['Arbre de transmission (Cardan)'], de: 'Antriebswelle', es: 'Árbol de transmisión / Palier', it: null, en: 'Driveshaft / CV Axle' },
    // Transmission
    { fr: ['Soufflet de cardan'], de: 'Achsmanschette', es: 'Fuelle de palier', it: null, en: 'CV boot' },
    // Transmission
    { fr: ['Joint homocinétique'], de: 'Gleichlaufgelenk', es: 'Junta homocinética', it: null, en: 'CV joint' },
    // Transmission
    { fr: ['Différentiel'], de: 'Differential', es: 'Diferencial', it: null, en: 'Differential' },
    // Transmission
    { fr: ['Boîte de transfert'], de: 'Verteilergetriebe', es: 'Caja de transferencia', it: null, en: 'Transfer case' },
    // Suspension
    { fr: ['Amortisseur avant'], de: 'Stoßdämpfer vorne', es: 'Amortiguador delantero', it: null, en: 'Front shock absorber' },
    // Suspension
    { fr: ['Amortisseur arrière'], de: 'Stoßdämpfer hinten', es: 'Amortiguador trasero', it: null, en: 'Rear shock absorber' },
    // Suspension
    { fr: ['Ressort hélicoïdal'], de: 'Fahrwerksfeder', es: 'Muelle helicoidal', it: null, en: 'Coil spring' },
    // Suspension
    { fr: ['Coupelle d\'amortisseur'], de: 'Domlager', es: 'Copela de amortiguador', it: null, en: 'Strut mount' },
    // Suspension
    { fr: ['Triangle de suspension'], de: 'Querlenker', es: 'Brazo de suspensión', it: null, en: 'Control arm' },
    // Suspension
    { fr: ['Rotule de suspension'], de: 'Traggelenk', es: 'Rótula de suspensión', it: null, en: 'Ball joint' },
    // Suspension
    { fr: ['Barre stabilisatrice'], de: 'Stabilisator', es: 'Barra estabilizadora', it: null, en: 'Sway bar / Stabilizer bar' },
    // Suspension
    { fr: ['Biellette de barre stabilisatrice'], de: 'Koppelstange', es: 'Bieleta de suspensión', it: null, en: 'Sway bar link' },
    // Suspension
    { fr: ['Crémaillère de direction'], de: 'Lenkgetriebe', es: 'Cremallera de dirección', it: null, en: 'Steering rack' },
    // Suspension
    { fr: ['Pompe de direction assistée'], de: 'Servopumpe', es: 'Bomba de dirección', it: null, en: 'Power steering pump' },
    // Suspension
    { fr: ['Rotule de direction'], de: 'Spurstangenkopf', es: 'Rótula de dirección', it: null, en: 'Tie rod end' },
    // Suspension
    { fr: ['Biellette de direction'], de: 'Axialgelenk', es: 'Bieleta de dirección', it: null, en: 'Inner tie rod' },
    // Suspension
    { fr: ['Roulement de roue'], de: 'Radlager', es: 'Rodamiento de rueda', it: null, en: 'Wheel bearing' },
    // Suspension
    { fr: ['Moyeu de roue'], de: 'Radnabe', es: 'Cubo de rueda', it: null, en: 'Wheel hub' },
    // Freinage
    { fr: ['Plaquettes de frein avant'], de: 'Bremsbeläge vorne', es: 'Pastillas de freno delanteras', it: null, en: 'Front brake pads' },
    // Freinage
    { fr: ['Plaquettes de frein arrière'], de: 'Bremsbeläge hinten', es: 'Pastillas de freno traseras', it: null, en: 'Rear brake pads' },
    // Freinage
    { fr: ['Disque de frein'], de: 'Bremsscheibe', es: 'Disco de freno', it: null, en: 'Brake rotor / Disc' },
    // Freinage
    { fr: ['Étrier de frein'], de: 'Bremssattel', es: 'Pinza de freno', it: null, en: 'Brake caliper' },
    // Freinage
    { fr: ['Piston d\'étrier'], de: 'Bremskolben', es: 'Pistón de pinza', it: null, en: 'Caliper piston' },
    // Freinage
    { fr: ['Maître-cylindre de frein'], de: 'Hauptbremszylinder', es: 'Cilindro maestro de frenos', it: null, en: 'Brake master cylinder' },
    // Freinage
    { fr: ['Servofrein (Mastervac)'], de: 'Bremskraftverstärker', es: 'Servofreno', it: null, en: 'Brake booster' },
    // Freinage
    { fr: ['Liquide de frein'], de: 'Bremsflüssigkeit', es: 'Líquido de frenos', it: null, en: 'Brake fluid' },
    // Freinage
    { fr: ['Flexible de frein'], de: 'Bremsschlauch', es: 'Latiguillo de freno', it: null, en: 'Brake hose' },
    // Freinage
    { fr: ['Câble de frein à main'], de: 'Handbremsseil', es: 'Cable de freno de mano', it: null, en: 'Parking brake cable' },
    // Freinage
    { fr: ['Tambour de frein'], de: 'Bremstrommel', es: 'Tambor de freno', it: null, en: 'Brake drum' },
    // Freinage
    { fr: ['Mâchoires de frein'], de: 'Bremsbacken', es: 'Zapatas de freno', it: null, en: 'Brake shoes' },
    // Freinage
    { fr: ['Cylindre de roue'], de: 'Radbremszylinder', es: 'Bombín de freno', it: null, en: 'Wheel cylinder' },
    // Électricité
    { fr: ['Batterie'], de: 'Batterie', es: 'Batería', it: null, en: 'Battery' },
    // Électricité
    { fr: ['Alternateur'], de: 'Lichtmaschine', es: 'Alternador', it: null, en: 'Alternator' },
    // Électricité
    { fr: ['Démarreur'], de: 'Anlasser', es: 'Motor de arranque', it: null, en: 'Starter motor' },
    // Électricité
    { fr: ['Bougie d\'allumage'], de: 'Zündkerze', es: 'Bujía de encendido', it: null, en: 'Spark plug' },
    // Électricité
    { fr: ['Bougie de préchauffage'], de: 'Glühkerze', es: 'Bujía de precalentamiento', it: null, en: 'Glow plug' },
    // Électricité
    { fr: ['Bobine d\'allumage'], de: 'Zündspule', es: 'Bobina de encendido', it: null, en: 'Ignition coil' },
    // Électricité
    { fr: ['Faisceau d\'allumage'], de: 'Zündkabel', es: 'Cables de encendido', it: null, en: 'Ignition cable kit' },
    // Électricité
    { fr: ['Fusible'], de: 'Sicherung', es: 'Fusible', it: null, en: 'Fuse' },
    // Électricité
    { fr: ['Relais'], de: 'Relais', es: 'Relé', it: null, en: 'Relay' },
    // Électricité
    { fr: ['Calculateur moteur (ECU)'], de: 'Motorsteuergerät', es: 'Unidad de control de motor (ECU)', it: null, en: 'Engine Control Unit (ECU)' },
    // Électricité
    { fr: ['Prise OBD2'], de: 'OBD2-Stecker', es: 'Puerto OBD2', it: null, en: 'OBD2 port' },
    // Électricité
    { fr: ['Faisceau électrique'], de: 'Kabelbaum', es: 'Mazo de cables', it: null, en: 'Wiring harness' },
    // Capteurs
    { fr: ['Débitmètre d\'air (MAF)'], de: 'Luftmassenmesser', es: 'Caudalímetro', it: null, en: 'Mass Air Flow sensor' },
    // Capteurs
    { fr: ['Capteur de pression absolue (MAP)'], de: 'Saugrohrdrucksensor', es: 'Sensor MAP', it: null, en: 'MAP sensor' },
    // Capteurs
    { fr: ['Capteur PMH (Vilebrequin)'], de: 'Kurbelwellensensor', es: 'Sensor del cigüeñal', it: null, en: 'Crankshaft position sensor' },
    // Capteurs
    { fr: ['Capteur d\'arbre à cames'], de: 'Nockenwellensensor', es: 'Sensor del árbol de levas', it: null, en: 'Camshaft position sensor' },
    // Capteurs
    { fr: ['Capteur de température d\'eau'], de: 'Kühlmitteltemperatursensor', es: 'Sensor de temperatura del refrigerante', it: null, en: 'Coolant temperature sensor' },
    // Capteurs
    { fr: ['Capteur ABS'], de: 'ABS-Sensor', es: 'Sensor ABS', it: null, en: 'ABS sensor' },
    // Capteurs
    { fr: ['Capteur de cliquetis'], de: 'Klopfsensor', es: 'Sensor de detonación', it: null, en: 'Knock sensor' },
    // Capteurs
    { fr: ['Capteur de pression d\'huile'], de: 'Öldruckschalter', es: 'Sensor de presión de aceite', it: null, en: 'Oil pressure switch' },
    // Capteurs
    { fr: ['Capteur de position du papillon'], de: 'Drosselklappenpotentiometer', es: 'Sensor de posición de mariposa', it: null, en: 'Throttle position sensor' },
    // Carrosserie
    { fr: ['Phare avant'], de: 'Scheinwerfer', es: 'Faro delantero', it: null, en: 'Headlight' },
    // Carrosserie
    { fr: ['Feu arrière'], de: 'Rückleuchte', es: 'Piloto trasero', it: null, en: 'Tail light' },
    // Carrosserie
    { fr: ['Clignotant'], de: 'Blinker', es: 'Intermitente', it: null, en: 'Turn signal / Indicator' },
    // Carrosserie
    { fr: ['Ampoule (H7, LED, etc.)'], de: 'Glühbirne', es: 'Bombilla', it: null, en: 'Bulb' },
    // Carrosserie
    { fr: ['Pare-chocs avant'], de: 'Stoßstange vorne', es: 'Parachoques delantero', it: null, en: 'Front bumper' },
    // Carrosserie
    { fr: ['Pare-chocs arrière'], de: 'Stoßstange hinten', es: 'Parachoques trasero', it: null, en: 'Rear bumper' },
    // Carrosserie
    { fr: ['Aile'], de: 'Kotflügel', es: 'Aleta', it: null, en: 'Fender' },
    // Carrosserie
    { fr: ['Capot'], de: 'Motorhaube', es: 'Capó', it: null, en: 'Hood' },
    // Carrosserie
    { fr: ['Rétroviseur'], de: 'Rückspiegel', es: 'Espejo retrovisor', it: null, en: 'Rear-view mirror' },
    // Carrosserie
    { fr: ['Vérin de hayon / capot'], de: 'Gasfeder', es: 'Amortiguador de maletero', it: null, en: 'Gas strut / Tailgate strut' },
    // Carrosserie
    { fr: ['Lève-vitre'], de: 'Fensterheber', es: 'Elevalunas', it: null, en: 'Window regulator' },
    // Carrosserie
    { fr: ['Moteur d\'essuie-glace'], de: 'Wischermotor', es: 'Motor del limpiaparabrisas', it: null, en: 'Wiper motor' },
    // Carrosserie
    { fr: ['Balai d\'essuie-glace'], de: 'Scheibenwischer', es: 'Escobilla limpiaparabrisas', it: null, en: 'Wiper blade' },
    // Climatisation
    { fr: ['Compresseur de climatisation'], de: 'Klimakompressor', es: 'Compresor de aire acondicionado', it: null, en: 'A/C Compressor' },
    // Climatisation
    { fr: ['Condenseur'], de: 'Klimakondensator', es: 'Condensador', it: null, en: 'A/C Condenser' },
    // Climatisation
    { fr: ['Évaporateur'], de: 'Verdampfer', es: 'Evaporador', it: null, en: 'Evaporator' },
    // Climatisation
    { fr: ['Détendeur'], de: 'Expansionsventil', es: 'Válvula de expansión', it: null, en: 'Expansion valve' },
    // Climatisation
    { fr: ['Filtre déshydratant'], de: 'Trockner', es: 'Filtro deshidratador', it: null, en: 'Receiver drier' },
    // Climatisation
    { fr: ['Pulseur d\'air (Ventilateur habitacle)'], de: 'Gebläsemotor', es: 'Ventilador del habitáculo', it: null, en: 'Blower motor' },
];
