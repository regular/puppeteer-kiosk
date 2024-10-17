eval $(ssh-agent)
ssh-add
export SSH_AUTH_SOCK=$(ls /tmp/ssh-*/agent.*)

