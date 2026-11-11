/** Name pools by nationality: common given names and surnames (fictional players, so everyday names rather than
 *  famous footballers). Underscores stand for spaces in multi-word surnames. Pools are sized to how many players of
 *  each nationality the world generates, so repeats are rare. */
const P = (first: string, last: string) => ({ first: first.trim().split(/\s+/), last: last.trim().split(/\s+/).map((s) => s.replace(/_/g, ' ')) });

export const NAMES: Record<string, { first: string[]; last: string[] }> = {
  England: P(
    `Harry Jack Oliver Callum Reece Marcus Declan Mason Kyle Jordan Lewis Conor Aaron Ben George Charlie James Thomas Samuel Joe Daniel
     Ryan Luke Adam Nathan Liam Jamie Ethan Josh Elliot Owen Tom Alfie Archie Freddie Leo Max Toby Rory Sam Billy Danny Connor Tyler
     Bradley Ashley Curtis Dominic Ellis Finley Gareth Henry Isaac Jake Kieran Louis Matty Noah Ollie Patrick Robbie Scott Stuart Tristan
     Wes Zack Ronan Jacob Rhys`,
    `Walker Hughes Bennett Shaw Barnes Wright Palmer Mills Hardy Clarke Dawson Turner Cooper Ward Morris Cole Lloyd Fletcher Holmes
     Parker Hayes Wood Watson Bailey Murphy Harrison Gibson Chapman Ellis Marshall Webb Lawrence Pearson Hall Spencer Atkinson Bradshaw
     Carter Doyle Fowler Gardner Hammond Ingram Jarvis Kemp Lambert Maddox Norris Osborne Pritchard Quinn Rowe Sutton Tate Underwood
     Vaughan Whitfield Yates Archer Blake Booth Burrows Cartwright Coleman Draper Fenwick Gough Hartley Holloway Kirby Lowe Marsh Naylor
     Oakley Pike Radcliffe Sharpe Stanton Thornton Wilkes Ashworth Brennan`),
  Spain: P(
    `Pablo Álvaro Dani Marcos Sergio Rodrigo Iker Álex Mikel Jordi Nico Unai Ferran Raúl Javier Carlos Adrián Diego Hugo Mario Rubén
     Iván Óscar Víctor Jaime Gonzalo Manuel Fernando Luis Jorge Andrés Alberto Rafael Ignacio Aitor Asier Borja Joel Martín Óliver
     Samuel Bruno Héctor Eric Pau Aleix Gerard Marc Arnau Guillem Íñigo Julen Ander Oier Jon`,
    `García Hernández Torres Navarro Ruiz Morales Iglesias Vidal Castro Soler Llorente Merino Romero Delgado Ortega Ramos Gil Serrano
     Blanco Molina Suárez Rubio Marín Sanz Domínguez Vázquez Ramírez Muñoz Herrera Medina Garrido Cortés Castillo Santana Guerrero
     Lozano Cano Prieto Méndez Calvo Gallego Vega León Peña Flores Cabrera Campos Fuentes Carrasco Diez Caballero Nieto Aguilar Pascual
     Herrero Montero Hidalgo Gimeno Ibáñez Bravo Rojas Arias Vera Mora Pardo Aranda Benítez Etxeberria Aguirre Zubiri Arrieta
     Lorente Mateos Rivas Sáez Crespo Esteban Lozada Gutiérrez Parra Robledo Toledo Cuesta Quesada Salvador Ferrer Puig Casas Font Roig Vidal_Puig`),
  Italy: P(
    `Marco Lorenzo Alessandro Federico Giovanni Nicolò Matteo Davide Riccardo Gianluca Leonardo Manuel Giacomo Andrea Simone Luca
     Francesco Stefano Daniele Mattia Gabriele Tommaso Edoardo Filippo Pietro Michele Antonio Fabio Paolo Emanuele Cristian Samuele
     Diego Raffaele Vincenzo Enrico Claudio Alberto Massimo Roberto Salvatore Domenico Giuseppe Mirko Valerio Ivan Elia Kevin Alessio`,
    `Rossi Bianchi Romano Ricci Conti Esposito Greco Lombardi Moretti Pellegrini Colombo Bruno Gallo Costa Fontana Marino Rinaldi Caruso
     Ferrara Galli Martini Leone Longo Gentile Martinelli Vitale Serra Coppola Santoro Marchetti Mariani Ferri Fabbri Villa Cattaneo
     Barbieri Parisi Sala De_Luca Grasso Benedetti Monti Sorrentino Farina Morelli Testa Silvestri Palumbo Valentini Orlando Bellini
     Guerra Basile Cristiani Piras Riva Donati Mancini Neri D'Angelo Fiore Messina Tedesco Zanetti Lazzari Ruggiero Sartori`),
  Germany: P(
    `Leon Jonas Florian Kai Joshua Niklas Julian Robin Jamal Maximilian Tim Lukas Benjamin Nico Felix Paul Elias Finn Luca Jan Moritz
     David Tobias Marvin Dennis Kevin Sebastian Philipp Alexander Christian Fabian Dominik Marcel Patrick Simon Stefan Tom Yannik Lennart
     Malte Jannik Hendrik Mats Leroy Ole Till Jakob Johannes Matthias`,
    `Müller Schmidt Fischer Weber Wagner Becker Hofmann Koch Richter Brandt Schulz Schäfer Bauer Klein Wolf Neumann Schwarz Zimmermann
     Braun Krüger Hartmann Lange Werner Krause Lehmann Köhler Herrmann König Walter Mayer Huber Kaiser Fuchs Peters Lang Scholz Möller
     Weiß Jung Hahn Vogel Friedrich Keller Günther Frank Berger Winkler Roth Beck Lorenz Baumann Franke Albrecht Schuster Simon Ludwig
     Böhm Winter Kraus Martin Schumacher Krämer Vogt Stein Jäger Otto Sommer Groß Seidel Heinrich`),
  France: P(
    `Antoine Théo Jules Aurélien Hugo Mathis Rayan Warren Benjamin Olivier Lucas Maxime Nathan Clément Romain Julien Thomas Alexandre
     Quentin Baptiste Kévin Florian Adrien Valentin Bastien Corentin Damien Enzo Kylian Mattéo Noah Louis Paul Gabriel Raphaël Arthur
     Sacha Yanis Ibrahim Moussa Amine Malik Wesley Loïc Jordan Yann Cyril Sébastien`,
    `Martin Bernard Dubois Laurent Lefebvre Moreau Girard Fournier Thomas Robert Richard Petit Durand Leroy Simon Michel Garcia David
     Bertrand Roux Vincent Fontaine Rousseau Blanc Guerin Muller Henry Roussel Nicolas Perrin Morin Mathieu Clement Gauthier Dumont
     Lopez Mercier Lambert Bonnet François Legrand Garnier Faure Andre Chevalier Barbier Brun Picard Gaillard Renard Lemaire Colin Arnaud`),
  Netherlands: P(
    `Daan Sem Thijs Lars Stijn Bram Jesse Ruben Tim Luuk Joep Teun Sven Niels Jasper Bart Wout Koen Rick Mats Gijs Pim Jelle Floris Tijn
     Milan Noah Dylan Kevin Jordy Mitchell Quinten Ryan Sander Vincent Wesley`,
    `de_Jong de_Vries van_den_Berg van_Dijk Bakker Janssen Visser Smit Meijer de_Boer Mulder de_Groot Bos Vos Peters Hendriks van_Leeuwen
     Dekker Brouwer de_Wit Dijkstra Smits de_Graaf van_der_Meer van_der_Linden Kok Jacobs de_Haan Vermeulen van_den_Heuvel van_der_Veen
     van_den_Broek de_Bruijn de_Bruin van_der_Heijden Schouten van_Beek Willems van_Vliet van_de_Ven Hoekstra Maas Verhoeven Koster
     Prins Blom Huisman Kuipers`),
  Portugal: P(
    `João Bruno Rafael Rúben Bernardo Diogo Gonçalo Nuno Pedro Francisco Tiago André Ricardo Miguel Rodrigo Tomás Duarte Martim Afonso
     Henrique Hugo Fábio Filipe Luís Vasco Simão Gustavo Daniel David Sérgio`,
    `Silva Santos Ferreira Pereira Oliveira Costa Rodrigues Martins Jesus Sousa Fernandes Gonçalves Gomes Lopes Marques Alves Almeida
     Ribeiro Pinto Carvalho Teixeira Moreira Correia Mendes Nunes Soares Vieira Monteiro Cardoso Rocha Raposo Neves Coelho Cruz Cunha
     Pires Ramos Reis Simões Antunes Matos Fonseca Machado Araújo Barbosa Tavares Lourenço`),
  USA: P(
    `Christian Weston Tyler Ricardo Chris Tim Brenden Matt Josh Jordan Kellyn Paxton Aidan Brandon Cameron Caleb Cole Dante Ethan Gavin
     Hunter Jaylin Justin Kai Landon Logan Mason Miles Nathan Owen Parker Reggie Sean Travis Zack DeAndre Malik Diego Bryce`,
    `Johnson Williams Brown Jones Miller Davis Wilson Anderson Taylor Thomas Moore Jackson White Harris Martin Thompson Robinson Lewis
     Walker Allen Young King Scott Green Baker Adams Nelson Hill Campbell Mitchell Roberts Carter Phillips Evans Collins Stewart Morris
     Rogers Reed Cook Bell Murphy Bailey Cooper Howard Ward Brooks Gray Sanders`),
  Brazil: P(
    `Vinícius Rodrygo Lucas Gabriel Matheus Danilo Bruno Thiago Felipe Rafael Douglas Everton Gustavo Leonardo Pedro Igor Caio Diego
     Wesley Willian Arthur João Vitor Marcos Renan Kaio Luan Murilo Yuri Breno Davi Enzo Guilherme Henrique Kauã Ramon Samuel Wendel`,
    `Silva Souza Oliveira Santos Lima Pereira Costa Ribeiro Rodrigues Almeida Nascimento Carvalho Araújo Gomes Martins Rocha Barbosa
     Cardoso Teixeira Correia Dias Moreira Mendes Freitas Cavalcanti Monteiro Campos Moura Batista Vieira Nunes Ramos Pinto Reis Farias
     Castro Andrade Melo Lopes Azevedo Duarte Machado Fonseca Siqueira Assis Moraes`),
  Argentina: P(
    `Julián Enzo Alexis Lautaro Nicolás Cristian Emiliano Lisandro Nahuel Giovani Exequiel Leandro Facundo Gonzalo Franco Valentín
     Agustín Tomás Santiago Matías Joaquín Lucas Marcos Ezequiel Ramiro Thiago Bautista Benjamín Maximiliano Federico`,
    `González Rodríguez Gómez Fernández López Díaz Martínez Pérez Sánchez Romero Sosa Álvarez Torres Ruiz Ramírez Flores Benítez Acosta
     Medina Herrera Aguirre Giménez Gutiérrez Pereyra Molina Castro Ortiz Silva Núñez Rojas Ferreyra Luna Juárez Cabrera Ríos Morales`),
  Japan: P(
    `Takefusa Kaoru Ritsu Wataru Daichi Takumi Hiroki Ayase Ko Junya Keito Reo Yuki Shogo Haruto Sota Ren Yuto Riku Kaito Hayato Daiki
     Kenta Shota Ryo Kazuki Naoki Yuma Tsubasa Genki`,
    `Sato Suzuki Takahashi Tanaka Watanabe Ito Yamamoto Nakamura Kobayashi Kato Yoshida Yamada Sasaki Yamaguchi Matsumoto Inoue Kimura
     Hayashi Shimizu Yamazaki Mori Abe Ikeda Hashimoto Ishikawa Ogawa Okada Goto Hasegawa Murakami Kondo Ishii Sakamoto`),
  'Saudi Arabia': P(
    `Salem Saud Firas Ali Abdullah Mohammed Turki Nasser Fahad Sultan Hassan Yasser Khalid Abdulrahman Marwan Faisal Hamad Majed Omar
     Rayan Saleh Ziyad Bandar Nawaf Ahmed Mansour Hattan Musab Riyadh Awad`,
    `Al-Dossary Al-Shehri Al-Hassan Al-Malki Al-Ghamdi Al-Otaibi Al-Qahtani Al-Harbi Al-Amri Al-Zahrani Al-Mutairi Al-Anazi Al-Shammari
     Al-Rashidi Al-Juhani Al-Subaie Al-Yami Al-Shahrani Al-Faraj Al-Saqri Al-Khaibari Al-Hamdan Al-Najjar Al-Muwallad Al-Obaid Al-Rubaie
     Al-Abed Al-Saleh Al-Tamimi Al-Bishi Al-Kathiri Al-Muqbel`),
  Belgium: P(
    `Kevin Jérémy Leandro Youri Charles Amadou Arthur Loïs Johan Thibaut Axel Dries Hans Timothy Maxime Wout Jens Lander Arne Senne Ruben
     Thomas Brecht Simon Mathias Cédric Nathan Sébastien Pieter Tibo Jari Dante Romeo Aster`,
    `Peeters Janssens Maes Jacobs Mertens Willems Claes Goossens Wouters De_Smet Dubois Lambert Dupont Martens Hermans Leclercq Vermeulen
     Michiels Pauwels Desmet Smets Lemmens Coppens De_Clercq Vandenberghe Van_Damme Verstraete Declercq Wuyts Cools Segers Aerts Hendrickx
     Van_Acker Bastin Lejeune Renard Collard`),
  Scotland: P(
    `Andrew Scott Callum Ryan Kieran Stuart Craig Fraser Ewan Lewis Calum Grant Euan Rory Murray Lyndon Kenny Robbie Greg Ross Jamie
     Lachlan Blair Gordon Struan Angus Finlay Hamish Alasdair Duncan`,
    `MacDonald Robertson McTominay McGinn Christie Gilmour Hendry Tierney Dykes McKenna Armstrong Adams Fraser Campbell Stewart Anderson
     McLean Paterson Morrison Ross Mackenzie Reid Murray Kerr Johnstone Hamilton Graham Sinclair Crawford Ferguson Cunningham Wallace
     Dunlop Moffat Baird Galloway Buchanan Kennedy Lindsay Cameron`),
  Turkey: P(
    `Arda Hakan Kerem Kenan Orkun Ferdi Barış Cengiz Salih Mert Abdülkerim Yusuf Emre Burak Ozan Okay Çağlar Ahmed Semih Bertuğ Altay
     Uğurcan Can Doğukan Efe Eren Furkan Kaan Onur Serdar Taylan Tolga Yunus Zeki`,
    `Yılmaz Kaya Demir Şahin Çelik Yıldız Yıldırım Öztürk Aydın Özdemir Arslan Doğan Kılıç Aslan Çetin Kara Koç Kurt Özkan Şimşek Polat
     Korkmaz Özer Güneş Aktaş Erdoğan Çakır Tekin Bulut Ünal Avcı Karaca Bozkurt Taş Keskin Akın Turan Uçar Bayram`),
  Mexico: P(
    `Hirving Edson Santiago Raúl César Johan Luis Jorge Orbelín Uriel Alexis Diego Erick Héctor Israel Jesús Julián Kevin Marcelo Ricardo
     Roberto Rodolfo Ulises Alan Brian Carlos Fernando Gerardo Guillermo Javier Rogelio Sebastián`,
    `Corona Ochoa Guardado Salcedo Montes Vela Alvarado Orozco Zavala Villalobos Valdivia Escobedo Arellano Cervantes Becerra Cisneros
     Elizondo Esquivel Galindo Garza Lara Lugo Macías Maldonado Montoya Nava Olvera Pacheco Quintana Rangel Robles Rosales Saucedo Solís
     Tapia Treviño Trujillo Urías Valadez Villarreal Zamora Zúñiga Aceves Barrera Camacho Carrillo Cárdenas Cázares Delgadillo Espinoza
     Figueroa Gallardo Granados Huerta Jaramillo Ledesma Leyva Mejía Montaño Navarrete Ocampo Ponce Quiroz Salinas Sepúlveda Tovar
     Valenzuela Yáñez`),
  Nigeria: P(`Victor Ademola Samuel Kelechi Alex Wilfred Calvin Frank Taiwo Moses Chidera Emeka Ikenna Tobi Uche Femi Sola Bright Chinedu Daniel`,
    `Okafor Eze Adeyemi Okonkwo Nwosu Balogun Ogunleye Uchenna Afolabi Onyeka Babatunde Obi Adebayo Chukwu Oyelaran Akinola Nnamdi Ojo Ibe Okoro Ekong Olatunji`),
  Senegal: P(`Kalidou Idrissa Ismaïla Boulaye Nicolas Iliman Pape Habib Lamine Moussa Cheikh Mamadou Abdou Youssouf Bamba Saliou`,
    `Ndiaye Diallo Camara Diatta Faye Sow Ba Cissé Seck Diop Gueye Mbaye Fall Thiam Ndour Sarr Badji Kouyaté Sylla Diedhiou`),
  Croatia: P(`Luka Mateo Ivan Andrej Lovro Bruno Josip Borna Dominik Marko Ante Nikola Toni Filip Mislav Petar`,
    `Horvat Kovačević Babić Marić Jurić Novak Knežević Vuković Marković Petrović Matić Tomić Pavlović Božić Grgić Perić Šarić Lovrić Vidović Radić`),
  'South Korea': P(`Min-jae Kang-in Woo-yeong Jin-su Sang-ho Seung-ho Hyun-woo Tae-hwan Ji-sung Dong-hyun Jae-sung Gyu-sung Young-woo Chan-hee`,
    `Kim Lee Park Choi Jung Kang Cho Yoon Jang Lim Han Oh Seo Shin Kwon Hwang Ahn Song`),
  Norway: P(`Martin Alexander Sander Antonio Oscar Kristoffer Fredrik Jørgen Leo Magnus Håkon Sindre Even Eirik Ola Tobias`,
    `Hansen Johansen Olsen Larsen Andersen Pedersen Nilsen Kristiansen Jensen Karlsen Johnsen Pettersen Eriksen Berg Haugen Hagen Strand Solberg Lund Dahl`),
  Uruguay: P(`Federico Ronald Manuel Rodrigo Facundo Matías Nicolás Maximiliano Sebastián Agustín Brian Diego Gastón Joaquín Santiago`,
    `Pereira Fernández Suárez Silva Cabrera Viera Olivera Castro Correa Méndez Acosta Píriz Bentancor Arrascaeta Laxalt Coates Lemos Nández`),
  Ghana: P(`Kwame Kofi Kwabena Yaw Kwaku Kojo Thomas Mohammed Inaki Ernest Elisha Abdul Joseph Daniel`,
    `Mensah Boateng Owusu Asante Osei Agyemang Appiah Ofori Amoah Sarpong Addo Frimpong Danso Ankrah Opoku Acheampong`),
  'Ivory Coast': P(`Franck Sébastien Serge Wilfried Simon Ibrahim Odilon Jean-Philippe Evan Hamed Seko Karim Nicolas Willy`,
    `Koné Traoré Touré Kouassi Bamba Coulibaly Diomandé Konan Yao Kouamé Ouattara Doumbia Fofana Sangaré Gbamin Kessié`),
  Morocco: P(`Achraf Hakim Youssef Sofyan Azzedine Bilal Nayef Romain Abdelhamid Ilias Selim Amine Brahim Ayoub Zakaria`,
    `El_Amrani Benali Alaoui Idrissi Bennani Tazi Chraibi El_Fassi Berrada Lahlou Ziani Ouahbi Amrabat Saiss Hamdallah El_Khannouss`),
  Colombia: P(`James Luis Juan Jhon Davinson Yerry Rafael Mateus Jefferson Richard Daniel Kevin Andrés Camilo Santiago`,
    `Rodríguez Díaz Cuadrado Sánchez Mina Borja Arias Uribe Lerma Ríos Muñoz Cardona Quintero Valencia Mosquera Palacios Castaño Zapata`),
  Denmark: P(`Christian Pierre-Emile Kasper Rasmus Mikkel Joakim Andreas Jonas Mathias Jesper Morten Frederik Mads Anders Victor`,
    `Nielsen Jensen Hansen Pedersen Andersen Christensen Larsen Sørensen Rasmussen Jørgensen Petersen Madsen Kristensen Olsen Thomsen Poulsen Møller Mortensen`),
  Poland: P(`Robert Piotr Wojciech Jakub Kamil Krzysztof Mateusz Przemysław Sebastian Bartosz Paweł Michał Łukasz Tomasz Adam`,
    `Nowak Kowalski Wiśniewski Wójcik Kowalczyk Kamiński Lewandowski Zieliński Szymański Woźniak Dąbrowski Kozłowski Jankowski Mazur Kwiatkowski Krawczyk Piotrowski Grabowski`),
  Serbia: P(`Dušan Aleksandar Nemanja Sergej Filip Strahinja Luka Lazar Nikola Uroš Marko Saša Miloš Andrija`,
    `Jovanović Petrović Nikolić Marković Đorđević Stojanović Ilić Stanković Pavlović Milošević Đurić Lukić Mitrović Živković Tadić Kostić`),
  Sweden: P(`Alexander Dejan Emil Victor Viktor Jesper Robin Ludwig Isak Anton Hugo Oscar Elias Gustav Filip`,
    `Johansson Andersson Karlsson Nilsson Eriksson Larsson Olsson Persson Svensson Gustafsson Pettersson Jonsson Lindberg Lindqvist Berglund Holm Sjöberg Ekdal`),
  Switzerland: P(`Granit Manuel Yann Nico Ricardo Denis Fabian Remo Silvan Noah Cédric Ruben Breel Dan`,
    `Müller Meier Schmid Keller Weber Huber Schneider Meyer Steiner Fischer Gerber Brunner Baumann Frei Zimmermann Moser Widmer Wyss`),
  Ireland: P(`Seamus Shane Darragh Cian Evan Callum Josh Matt Nathan Jayson Dara Gavin Aidan Cillian Eoin`,
    `Murphy Kelly O'Sullivan Walsh O'Brien Byrne Ryan O'Connor O'Neill O'Reilly Doyle McCarthy Gallagher Doherty Kennedy Lynch Quinn Brady`),
  Wales: P(`Gareth Aaron Daniel Joe Kieffer Ethan Brennan Neco Harry Connor Rhys Dylan Owain Ieuan`,
    `Jones Williams Davies Evans Thomas Roberts Hughes Lewis Morgan Griffiths Price Rees Powell Pritchard Llewellyn Vaughan Bowen Jenkins`),
  Austria: P(`David Marcel Konrad Christoph Stefan Xaver Nicolas Patrick Michael Florian Kevin Romano Philipp Maximilian`,
    `Gruber Huber Bauer Wagner Pichler Steiner Moser Mayer Hofer Leitner Berger Fuchs Eder Fischer Schmid Winkler Weber Schwarz`),
  Cameroon: P(`André Bryan Vincent Karl Eric Frank Martin Georges Jean-Charles Christian Olivier Samuel Ignatius`,
    `Mbeumo Aboubakar Toko Ekambi Onana Ngadeu Kunde Anguissa Tolo Nkoudou Fai Ngamaleu Castelletto Mbekeli Wooh Ebosse`),
  Ecuador: P(`Moisés Pervis Piero Enner Gonzalo Kendry Jeremy Ángel Byron Alan William Félix Carlos Jhegson`,
    `Caicedo Estupiñán Hincapié Valencia Plata Páez Sarmiento Mena Preciado Franco Torres Méndez Arboleda Ibarra Gruezo Cifuentes`),
};

/** Nationalities that turn up as imports in other countries' leagues. */
export const FOREIGN_POOL = ['Nigeria', 'Senegal', 'Belgium', 'Croatia', 'South Korea', 'Mexico', 'Norway', 'Uruguay', 'Brazil', 'Argentina', 'France',
  'Spain', 'Portugal', 'Netherlands', 'England', 'Germany', 'Italy', 'Ghana', 'Ivory Coast', 'Morocco', 'Colombia', 'Denmark', 'Poland', 'Serbia',
  'Sweden', 'Switzerland', 'Ireland', 'Wales', 'Austria', 'Cameroon', 'Ecuador', 'Scotland', 'Turkey', 'USA', 'Japan'];
