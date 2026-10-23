// Invented stand-in for a quiz script. It renders a button for each
// .quiz-placeholder, remembers the answer in localStorage under the quiz's
// name, and loads a helper script by a path built at run time (as the real
// quiz script loads its workers), so a saved copy has to include the helper.
(function () {
  var base = './quiz';
  document.querySelectorAll('.quiz-placeholder').forEach(function (el) {
    var name = JSON.parse(el.dataset.quizName);
    var q = JSON.parse(el.dataset.quizQuestions).questions[0];
    var saved = null;
    try { saved = localStorage.getItem('quiz:' + name); } catch (e) {}
    el.innerHTML = '<div class="quiz"><p class="prompt"></p><button type="button" class="start">Start</button><p class="result"></p></div>';
    el.querySelector('.prompt').textContent = q.prompt;
    var result = el.querySelector('.result');
    if (saved) result.textContent = 'Answered: ' + saved;
    el.querySelector('.start').addEventListener('click', function () {
      var answer = q.answer;
      try { localStorage.setItem('quiz:' + name, answer); } catch (e) {}
      result.textContent = 'Answered: ' + answer;
    });
  });
  var s = document.createElement('script');
  s.src = base + '/helper.js';
  document.head.appendChild(s);
})();
