# Amazon Textract Grader
This project uses AWS AI services to speed up grading task.

# AWS Cloud9 Setup Environment
git clone https://github.com/wongcyrus/amazon-textract-grader
cd amazon-textract-grader/
npm i nvm
nvm install
nvm alias default 14
npm install -g yarn
npm install -g --force npx
alias pj='npx projen'


## Cloud9 TypeScript Formatter
Follow
https://gist.github.com/wongcyrus/4e8a2e78045e11f7c5a55e4e244fe3d2


### Auto compile
You need to run TypeScript compiler at the background with new terminal.
npx projen watch
### Install all node packages
./install_all_packages.sh
### Upgrade all node packages
./upgrade_all_packages.sh
### Deployment
npx projen deploy
### Deployment hotswap
npx projen deploy-hotswap

#### Checkout projen documentation
https://github.com/projen/projen


Input format for CorrectPdfOrientationStateMachine and AssignmentsTextractStateMachine

<code>{
"key": "cywong@vtc.vtc.edu.hk/IT41213Testscript.pdf"
}</code>
