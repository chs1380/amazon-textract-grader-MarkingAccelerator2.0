# Amazon Textract Grader
This project uses AWS AI services to speed up grading task.

# Development
Use nodejs 14

nvm use 14

### Auto compile 
projen watch
###Install all node packages
./install_all_packages.sh
###Upgrade all node packages
./upgrade_all_packages.sh
###Deployment
projen deploy
###Deployment hotswap
projen deploy-hotswap

Input format for CorrectPdfOrientationStateMachine and AssignmentsTextractStateMachine

<code>{
"key": "cywong@vtc.vtc.edu.hk/IT41213Testscript.pdf"
}</code>
