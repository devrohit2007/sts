// Target ASL vocabulary: 50 core signs plus 50 extension signs (the path to 100).
// This is a list of what we WANT to recognise. It is not a claim that any of it is trained.
// Which signs a model really knows is decided by the labels.json that ships with that model.
const row = (gloss, meaning) => ({ gloss, meaning });

export const ASL_CORE = [
  row('HELLO', 'Hello'), row('GOODBYE', 'Goodbye'), row('PLEASE', 'Please'), row('THANK-YOU', 'Thank you'),
  row('SORRY', 'Sorry'), row('YES', 'Yes'), row('NO', 'No'), row('HELP', 'Help'), row('STOP', 'Stop'),
  row('WAIT', 'Wait'), row('WANT', 'Want'), row('NEED', 'Need'), row('LIKE', 'Like'), row('LOVE', 'Love'),
  row('EAT', 'Eat'), row('DRINK', 'Drink'), row('WATER', 'Water'), row('FOOD', 'Food'), row('MORE', 'More'),
  row('FINISH', 'Finished'), row('GOOD', 'Good'), row('BAD', 'Bad'), row('HAPPY', 'Happy'), row('SAD', 'Sad'),
  row('MOTHER', 'Mother'), row('FATHER', 'Father'), row('FAMILY', 'Family'), row('FRIEND', 'Friend'),
  row('NAME', 'Name'), row('HOME', 'Home'), row('SCHOOL', 'School'), row('WORK', 'Work'),
  row('BATHROOM', 'Bathroom'), row('DOCTOR', 'Doctor'), row('SICK', 'Sick'), row('HURT', 'Hurt or pain'),
  row('MEDICINE', 'Medicine'), row('HOSPITAL', 'Hospital'), row('UNDERSTAND', 'I understand'),
  row('KNOW', 'Know'), row('AGAIN', 'Again'), row('SLOW', 'Slow'), row('WHERE', 'Where'), row('WHAT', 'What'),
  row('WHO', 'Who'), row('WHEN', 'When'), row('WHY', 'Why'), row('HOW', 'How'), row('ME', 'I or me'), row('YOU', 'You'),
];

export const ASL_EXTENDED = [
  row('LEARN', 'Learn'), row('SLEEP', 'Sleep'), row('TIRED', 'Tired'), row('HUNGRY', 'Hungry'),
  row('THIRSTY', 'Thirsty'), row('COLD', 'Cold'), row('HOT', 'Hot'), row('ANGRY', 'Angry'),
  row('SCARED', 'Scared'), row('EXCITED', 'Excited'), row('SISTER', 'Sister'), row('BROTHER', 'Brother'),
  row('BABY', 'Baby'), row('BOY', 'Boy'), row('GIRL', 'Girl'), row('MAN', 'Man'), row('WOMAN', 'Woman'),
  row('TEACHER', 'Teacher'), row('STUDENT', 'Student'), row('BOOK', 'Book'), row('PHONE', 'Phone'),
  row('COMPUTER', 'Computer'), row('CAR', 'Car'), row('BUS', 'Bus'), row('MONEY', 'Money'), row('BUY', 'Buy'),
  row('TODAY', 'Today'), row('TOMORROW', 'Tomorrow'), row('YESTERDAY', 'Yesterday'), row('NOW', 'Now'),
  row('LATER', 'Later'), row('MORNING', 'Morning'), row('NIGHT', 'Night'), row('TIME', 'Time'),
  row('COME', 'Come'), row('GO', 'Go'), row('GIVE', 'Give'), row('SEE', 'See'), row('LOOK', 'Look'),
  row('HEAR', 'Hear'), row('SAY', 'Say'), row('READ', 'Read'), row('WRITE', 'Write'), row('PLAY', 'Play'),
  row('WALK', 'Walk'), row('RUN', 'Run'), row('SIT', 'Sit'), row('STAND', 'Stand'), row('OPEN', 'Open'),
  row('CLOSE', 'Close'),
];

export const ASL_TARGET = [...ASL_CORE, ...ASL_EXTENDED];
