const express = require('express');
const app = express();
const port = 3000;

app.get("/", (req, res)=>{
    res.send("Welcome to Scraper App");

});


async function checkRobotsTxt(){
    const robotUrl = `https://books.toscrape.com/robots.txt`;
    const response = await fetch(robotUrl);
    if(response.status === 200){
        const robotsTxt = await response.text();
        console.log(robotsTxt);
    } else if(response.status === 404){
        console.log('no robots file found');
      
    } else {
        console.log(`Error:  ${response.status}`)
        
    }
};


app.listen(port, ()=>{
    checkRobotsTxt();
    console.log(`Server is running on port ${port}`);
})