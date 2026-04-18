import React, { useState } from 'react';
import Swal from 'sweetalert2';

interface WelcomeScreenProps {
  onJoin: (name: string, controlMethod: string) => void;
}

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onJoin }) => {
  React.useEffect(() => {
    Swal.fire({
      title: "Welcome to Sketchbook!",
      text: "Feel free to explore the world and interact with available vehicles.",
      html: `
        <div style="margin-top: 20px;">
          <label for="swal-input-name" style="display: block; margin-bottom: 5px; font-weight: bold;">Your Name</label>
          <input id="swal-input-name" class="swal2-input" placeholder="Enter your name..." style="margin-top: 0; width: 80%;">
        </div>
        <div style="margin-top: 20px;">
          <label style="display: block; margin-bottom: 10px; font-weight: bold;">Control Method</label>
          <div style="display: flex; justify-content: space-around;">
            <label style="cursor: pointer;">
              <input type="radio" name="control-method" value="keyboard" checked style="margin-right: 5px;"> Keyboard
            </label>
            <label style="cursor: pointer;">
              <input type="radio" name="control-method" value="gamepad" style="margin-right: 5px;"> Gamepad
            </label>
          </div>
        </div>
      `,
      focusConfirm: false,
      confirmButtonText: "Join",
      allowOutsideClick: false,
      allowEscapeKey: false,
      preConfirm: () => {
        const name = (document.getElementById("swal-input-name") as HTMLInputElement).value;
        const controlMethod = (document.querySelector('input[name="control-method"]:checked') as HTMLInputElement).value;
        if (!name) {
          Swal.showValidationMessage("You need to write a name!");
          return false;
        }
        return { name, controlMethod };
      },
    }).then((result) => {
      if (result.isConfirmed) {
        onJoin(result.value.name, result.value.controlMethod);
      }
    });
  }, [onJoin]);

  return null;
};

export default WelcomeScreen;
